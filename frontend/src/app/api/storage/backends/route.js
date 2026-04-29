import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { getConfig, addBackend } from '@/lib/storage';
import { pingS3 } from '@/lib/s3Store';
import { pingMongo } from '@/lib/mongoStore';

function bad(detailKey, detail, status = 400, params) {
  const body = { detail, detail_key: detailKey };
  if (params) body.detail_params = params;
  return NextResponse.json(body, { status });
}

const SECRET_FIELDS = ['access_key_id', 'secret_access_key', 'uri'];

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
  if (!body.driver || !['file', 's3', 'mongo'].includes(body.driver)) {
    return bad('errors.invalid_body', 'driver must be file/s3/mongo');
  }
  if (body.driver !== 'file' && (!body.config || typeof body.config !== 'object')) {
    return bad('errors.invalid_body', 'config object is required for s3/mongo');
  }

  // Ping the backend before adding so we don't persist a broken config.
  if (body.driver === 's3') {
    try { await pingS3(body.config); }
    catch (err) {
      return bad('errors.backend_unreachable', `Cannot reach backend: ${err?.message || err}`, 400);
    }
  } else if (body.driver === 'mongo') {
    try { await pingMongo(body.config); }
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
