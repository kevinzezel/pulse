import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { getConfig } from '@/lib/storage';
import { listAllProjects, findProjectBackend } from '@/lib/projectIndex';
import { moveProjectShards } from '@/lib/projectMove';

function bad(detailKey, detail, status = 400, params) {
  const body = { detail, detail_key: detailKey };
  if (params) body.detail_params = params;
  return NextResponse.json(body, { status });
}

// POST /api/projects/[id]/move: move a project's shards from its current
// backend (resolved via the manifest scan) to `target_backend_id`. The
// underlying `moveProjectShards` already manipulates both source and dest
// `projects-manifest.json`, so once the call returns, listAllProjects()
// reports the project under the new backend without further bookkeeping.
export const POST = withAuth(async (req, { params }) => {
  const { id: projectId } = await params;
  let body;
  try { body = await req.json(); } catch { return bad('errors.invalid_body', 'Invalid JSON'); }
  const targetId = body?.target_backend_id;
  if (typeof targetId !== 'string' || !targetId) {
    return bad('errors.invalid_body', 'target_backend_id is required');
  }

  const cfg = await getConfig();
  const targetBackend = cfg.backends.find((b) => b.id === targetId);
  if (!targetBackend) {
    return bad('errors.backend_unknown', 'Target backend not found', 404, { id: targetId });
  }

  // Resolve the project's current home via manifest scan. We look it up by
  // listing because we also want the name/created_at to forward into the
  // dest manifest entry (moveProjectShards uses these for display).
  const all = await listAllProjects();
  const project = all.find((p) => p.id === projectId);
  if (!project) {
    return bad('errors.project_not_found', 'Project not found', 404, { project_id: projectId });
  }

  const sourceId = project.backend_id;
  if (sourceId === targetId) {
    return bad('errors.invalid_body', 'Project is already on the target backend', 400);
  }

  await moveProjectShards(projectId, sourceId, targetId, {
    name: project.name,
    created_at: project.created_at,
    toBackendName: targetBackend.name,
  });

  return NextResponse.json({
    id: projectId,
    storage_ref: targetId,
    name: project.name,
  });
});
