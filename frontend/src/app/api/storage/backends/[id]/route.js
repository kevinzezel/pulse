import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { getConfig, removeBackend, setDefaultBackend, updateBackend } from '@/lib/storage';
import { listAllProjects } from '@/lib/projectIndex';
import { pingS3 } from '@/lib/s3Store';

function bad(detailKey, detail, status = 400, params) {
  const body = { detail, detail_key: detailKey };
  if (params) body.detail_params = params;
  return NextResponse.json(body, { status });
}

const SECRET_PLACEHOLDER = '********';
const S3_SECRET_FIELDS = ['access_key_id', 'secret_access_key'];
const ALL_SECRET_FIELDS = [...S3_SECRET_FIELDS];

// Merge an incoming config patch with the existing backend config: any
// secret-bearing field whose value is the masked placeholder ("********")
// or empty/whitespace is restored from the existing config so the user can
// edit non-secret fields without retyping (or without inadvertently wiping)
// their credentials. Non-secret fields pass through as-is.
function mergeConfigPreservingSecrets(driver, existingConfig, patchConfig) {
  const merged = { ...patchConfig };
  const secretFields = driver === 's3' ? S3_SECRET_FIELDS : [];
  for (const field of secretFields) {
    const incoming = merged[field];
    const isPlaceholder = incoming === SECRET_PLACEHOLDER;
    const isEmpty = typeof incoming !== 'string' || incoming.trim() === '';
    if (isPlaceholder || isEmpty) {
      // Direct access — a backend that already passed POST validation has
      // these fields set, so a missing one means corruption upstream and
      // should fail loudly via the next ping rather than silently default.
      merged[field] = existingConfig[field];
    }
  }
  return merged;
}

// Mirror the masking applied by GET /api/storage/backends so PATCH responses
// never carry raw secrets back to the browser. Caller still has the values
// they typed; we just don't echo them.
function maskBackendForResponse(backend) {
  const config = backend.config || {};
  const masked = { ...config };
  for (const field of ALL_SECRET_FIELDS) {
    if (typeof masked[field] === 'string' && masked[field].length > 0) {
      masked[field] = SECRET_PLACEHOLDER;
    }
  }
  return { ...backend, config: masked };
}

export const PATCH = withAuth(async (req, { params }) => {
  const { id } = await params;
  let body;
  try { body = await req.json(); } catch { return bad('errors.invalid_body', 'Invalid JSON'); }

  if (body.set_default === true) {
    try {
      await setDefaultBackend(id);
      return NextResponse.json({ id, default: true });
    } catch (err) {
      return bad('errors.backend_unknown', err?.message || 'Unknown backend', 404);
    }
  }

  // Edit mode: { name?, config? }. The local backend has no editable config.
  if (id === 'local') {
    return bad('errors.backend_local_immutable', 'Cannot edit the local backend', 400);
  }

  const cfg = await getConfig();
  const existing = cfg.backends.find((b) => b.id === id);
  if (!existing) {
    return bad('errors.backend_unknown', `Unknown backend: ${id}`, 404);
  }

  const hasName = typeof body.name === 'string' && body.name.trim().length > 0;
  const hasConfig = body.config && typeof body.config === 'object';
  if (!hasName && !hasConfig) {
    return bad('errors.invalid_body', 'name or config is required');
  }

  const mergedConfig = hasConfig
    ? mergeConfigPreservingSecrets(existing.driver, existing.config || {}, body.config)
    : (existing.config || {});

  // Re-ping with the resolved config (placeholder secrets already swapped
  // back) so a broken edit never gets persisted.
  if (existing.driver === 's3') {
    try { await pingS3(mergedConfig); }
    catch (err) {
      return bad('errors.backend_unreachable', `Cannot reach backend: ${err?.message || err}`, 400);
    }
  }

  const patch = {};
  if (hasName) patch.name = body.name.trim();
  if (hasConfig) patch.config = mergedConfig;

  try {
    await updateBackend(id, patch);
  } catch (err) {
    return bad('errors.backend_unknown', err?.message || 'Unknown backend', 404);
  }

  return NextResponse.json({
    id,
    backend: maskBackendForResponse({
      id,
      name: patch.name ?? existing.name,
      driver: existing.driver,
      config: mergedConfig,
    }),
    detail_key: 'success.storage.backend_updated',
  });
});

export const DELETE = withAuth(async (req, { params }) => {
  const { id } = await params;

  if (id === 'local') {
    return bad('errors.backend_local_immutable', 'Cannot remove the local backend', 400);
  }

  // Block removal if any project still routes to this backend. Manifest-as-
  // truth (v4.2): the project list comes from each backend's own
  // projects-manifest.json, aggregated by listAllProjects.
  const all = await listAllProjects();
  const inUse = all.filter((p) => p.backend_id === id);
  if (inUse.length > 0) {
    return bad('errors.backend_in_use', `Backend has ${inUse.length} project(s) routed to it; move them first.`, 409, {
      count: inUse.length,
      project_names: inUse.slice(0, 5).map((p) => p.name),
    });
  }

  try {
    await removeBackend(id);
  } catch (err) {
    if (/default/i.test(err?.message || '')) {
      return bad('errors.backend_is_default', err.message, 400);
    }
    throw err;
  }

  return NextResponse.json({ id, removed: true });
});
