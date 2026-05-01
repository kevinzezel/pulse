import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { getConfig, addBackend } from '@/lib/storage';
import { pingS3 } from '@/lib/s3Store';

function bad(detailKey, detail, status = 400, params) {
  const body = { detail, detail_key: detailKey };
  if (params) body.detail_params = params;
  return NextResponse.json(body, { status });
}

const SECRET_FIELDS = ['access_key_id', 'secret_access_key'];

function maskBackendForDisplay(backend) {
  const config = backend.config || {};
  const masked = { ...config };
  for (const field of SECRET_FIELDS) {
    if (typeof masked[field] === 'string' && masked[field].length > 0) {
      masked[field] = '********';
    }
  }
  return { ...backend, config: masked };
}

export const GET = withAuth(async () => {
  const cfg = await getConfig();
  return NextResponse.json({
    v: cfg.v,
    backends: cfg.backends.map(maskBackendForDisplay),
    default_backend_id: cfg.default_backend_id,
  });
});

export const POST = withAuth(async (req) => {
  let body;
  try { body = await req.json(); } catch { return bad('errors.invalid_body', 'Invalid JSON'); }
  if (!body || typeof body.name !== 'string' || !body.name.trim()) {
    return bad('errors.invalid_body', 'name is required');
  }
  if (body.driver === 'mongo') {
    // v5.0 dropped mongo support entirely. Reject upfront so the user sees a
    // translated message instead of a generic "unknown driver" further down.
    return bad('errors.storage.unsupported_driver', 'MongoDB storage is no longer supported');
  }
  if (!body.driver || !['file', 's3'].includes(body.driver)) {
    return bad('errors.invalid_body', 'driver must be file/s3');
  }
  if (body.driver !== 'file' && (!body.config || typeof body.config !== 'object')) {
    return bad('errors.invalid_body', 'config object is required for s3');
  }

  // Ping the backend before adding so we don't persist a broken config.
  if (body.driver === 's3') {
    try { await pingS3(body.config); }
    catch (err) {
      return bad('errors.backend_unreachable', `Cannot reach backend: ${err?.message || err}`, 400);
    }
  }

  const id = await addBackend({
    name: body.name.trim(),
    driver: body.driver,
    config: body.config || {},
  });

  return NextResponse.json({ id }, { status: 201 });
});
