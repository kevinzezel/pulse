import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { removeBackend, setDefaultBackend } from '@/lib/storage';
import { listAllProjects } from '@/lib/projectIndex';

function bad(detailKey, detail, status = 400, params) {
  const body = { detail, detail_key: detailKey };
  if (params) body.detail_params = params;
  return NextResponse.json(body, { status });
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

  return bad('errors.invalid_body', 'Unsupported PATCH operation');
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
