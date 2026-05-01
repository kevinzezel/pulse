import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import {
  readConfigAsync,
  writeConfig,
  deleteConfig,
  getActiveDriver,
  getActiveConfig,
  reloadBackend,
  DRIVERS,
} from '@/lib/storage';
import { pingS3 } from '@/lib/s3Store';

// Attempt to activate a new config, and if reloadBackend fails, restore the
// previous on-disk config so the next boot isn't wedged. Ping validation
// happens before this — a reload failure here is rare (transient network
// between ping and init) but must not leave the app unable to start.
async function activateOrRollback(newConfigOrNull) {
  const previous = await readConfigAsync();
  if (newConfigOrNull) await writeConfig(newConfigOrNull);
  else await deleteConfig();
  try {
    await reloadBackend();
  } catch (err) {
    try {
      if (previous) await writeConfig(previous);
      else await deleteConfig();
      await reloadBackend();
    } catch {}
    throw err;
  }
}

function bad(detailKey, detail, status = 400, params) {
  const body = { detail, detail_key: detailKey };
  if (params) body.detail_params = params;
  return NextResponse.json(body, { status });
}

// User explicitly asked to expose full secrets via GET (plaintext). Access
// is still gated by withAuth + HttpOnly cookie, and the file on disk is
// plaintext anyway. Redaction was conservative; removing it lets the UI
// show masked display and copy the raw value on click.
//
// SECURITY: the response body carries plaintext secrets (S3 Secret Access
// Key). Do NOT add logging/tracing that stringifies the response, and do NOT
// extend this endpoint to be callable without `withAuth`.
export const GET = withAuth(async () => {
  const onDisk = await readConfigAsync();
  const activeDriver = getActiveDriver();
  const active = getActiveConfig();
  return NextResponse.json({
    driver: activeDriver,
    configured: !!onDisk,
    active: activeDriver !== 'file',
    config: onDisk || null,
    active_config: active,
  });
});

export const PUT = withAuth(async (req) => {
  let body;
  try { body = await req.json(); }
  catch { return bad('errors.invalid_body', 'Invalid JSON'); }

  const driver = typeof body?.driver === 'string' ? body.driver : null;
  if (driver === 'mongo') {
    // v5.0 dropped mongo. Surface a translatable error if a stale client/CLI
    // still posts the old shape. Specific message wins over the generic
    // "invalid_driver" the next branch would emit.
    return bad('errors.storage.unsupported_driver', 'MongoDB storage is no longer supported');
  }
  if (!driver || !DRIVERS.includes(driver)) {
    return bad('errors.storage.invalid_driver', 'Invalid driver', 400);
  }

  if (driver === 'file') {
    // Activating file mode = remove remote config. Equivalent to DELETE.
    try {
      await activateOrRollback(null);
    } catch (err) {
      return bad('errors.storage.reload_failed', `Storage reload failed: ${err?.message || err}`, 500, { reason: err?.message || String(err) });
    }
    return NextResponse.json({ detail_key: 'success.storage.file_activated', driver: 'file' });
  }

  if (driver === 's3') {
    const bucket = typeof body?.bucket === 'string' ? body.bucket.trim() : '';
    const accessKeyId = typeof body?.access_key_id === 'string' ? body.access_key_id.trim() : '';
    const secretAccessKey = typeof body?.secret_access_key === 'string' ? body.secret_access_key : '';

    if (!bucket) return bad('errors.s3.bucket_required', 'S3 bucket is required');
    if (!accessKeyId) return bad('errors.s3.access_key_required', 'S3 access key ID is required');
    if (!secretAccessKey) return bad('errors.s3.secret_key_required', 'S3 secret access key is required');

    const s3Config = {
      endpoint: typeof body?.endpoint === 'string' && body.endpoint.trim() ? body.endpoint.trim() : '',
      bucket,
      region: typeof body?.region === 'string' && body.region.trim() ? body.region.trim() : 'us-east-1',
      access_key_id: accessKeyId,
      secret_access_key: secretAccessKey,
      prefix: typeof body?.prefix === 'string' ? body.prefix.trim() : '',
      force_path_style: body?.force_path_style === true,
    };

    try {
      await pingS3(s3Config);
    } catch (err) {
      return bad(
        'errors.s3.connection_failed',
        `S3 connection failed: ${err?.message || err}`,
        400,
        { reason: err?.message || String(err) },
      );
    }

    try {
      await activateOrRollback({ driver: 's3', ...s3Config });
    } catch (err) {
      return bad('errors.storage.reload_failed', `Storage reload failed: ${err?.message || err}`, 500, { reason: err?.message || String(err) });
    }
    return NextResponse.json({
      detail_key: 'success.storage.config_activated',
      driver: 's3',
    });
  }

  return bad('errors.storage.invalid_driver', 'Invalid driver', 400);
});

export const DELETE = withAuth(async () => {
  const existed = !!(await readConfigAsync());
  try {
    await activateOrRollback(null);
  } catch (err) {
    return bad('errors.storage.reload_failed', `Storage reload failed: ${err?.message || err}`, 500, { reason: err?.message || String(err) });
  }
  return NextResponse.json({
    detail_key: existed ? 'success.storage.config_deactivated' : 'success.storage.config_already_absent',
    active: false,
    driver: 'file',
  });
});
