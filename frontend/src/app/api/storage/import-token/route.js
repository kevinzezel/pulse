import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { addBackend, readStoreFromBackend } from '@/lib/storage';
import { decodeBackendToken, BackendTokenError } from '@/lib/backendToken';
import { pingS3 } from '@/lib/s3Store';

function bad(detailKey, detail, status = 400, params) {
  const body = { detail, detail_key: detailKey };
  if (params) body.detail_params = params;
  return NextResponse.json(body, { status });
}

export const POST = withAuth(async (req) => {
  let body;
  try { body = await req.json(); } catch { return bad('errors.invalid_body', 'Invalid JSON'); }
  if (typeof body?.token !== 'string') {
    return bad('errors.invalid_body', 'token is required');
  }

  let decoded;
  try {
    decoded = decodeBackendToken(body.token);
  } catch (err) {
    if (err instanceof BackendTokenError) {
      return bad('errors.invalid_token', err.message, 400);
    }
    throw err;
  }

  const { backend } = decoded;

  // v5.0 dropped mongo support: an old token that still encodes a mongo
  // backend is rejected upfront with a translatable error.
  if (backend.driver === 'mongo') {
    return bad('errors.storage.unsupported_driver', 'MongoDB storage is no longer supported');
  }

  // Ping the backend before adding so we surface bad credentials immediately.
  try {
    if (backend.driver === 's3') await pingS3(backend.config);
  } catch (err) {
    return bad('errors.backend_unreachable', `Cannot reach backend: ${err?.message || err}`, 400);
  }

  // Optional rename via body.name (otherwise use the name embedded in the token).
  const name = (typeof body.rename === 'string' && body.rename.trim()) || backend.name;
  const id = await addBackend({ name, driver: backend.driver, config: backend.config });

  // Read the manifest so the UI can show the project preview. Path is
  // `data/projects-manifest.json` (S3/Mongo strip the prefix to keep the
  // bucket key the same as before; file driver lands inside `data/`).
  const manifest = await readStoreFromBackend(id, 'data/projects-manifest.json', { v: 1, projects: [] });
  const projects = Array.isArray(manifest?.projects) ? manifest.projects : [];

  return NextResponse.json({
    backend_id: id,
    backend_name: name,
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      created_at: p.created_at,
      updated_at: p.updated_at,
    })),
  }, { status: 201 });
});
