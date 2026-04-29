import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { getConfig } from '@/lib/storage';
import { readLocalStore, writeLocalStore, withLocalStoreLock } from '@/lib/projectStorage';
import { moveProjectShards } from '@/lib/projectMove';

const REL = 'data/projects.json';
const EMPTY = { projects: [], active_project_id: null };

function bad(detailKey, detail, status = 400, params) {
  const body = { detail, detail_key: detailKey };
  if (params) body.detail_params = params;
  return NextResponse.json(body, { status });
}

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

  const projectsDoc = await readLocalStore(REL, EMPTY);
  const projects = Array.isArray(projectsDoc?.projects) ? projectsDoc.projects : [];
  const project = projects.find((p) => p.id === projectId);
  if (!project) {
    return bad('errors.project_not_found', 'Project not found', 404, { project_id: projectId });
  }

  const sourceId = project.storage_ref || 'local';
  if (sourceId === targetId) {
    return bad('errors.invalid_body', 'Project is already on the target backend', 400);
  }

  await moveProjectShards(projectId, sourceId, targetId, {
    name: project.name,
    created_at: project.created_at,
    toBackendName: targetBackend.name,
  });

  // Cutover: update local projects.json with new storage_ref
  let updated;
  await withLocalStoreLock(REL, async () => {
    const doc = await readLocalStore(REL, EMPTY);
    const list = Array.isArray(doc?.projects) ? doc.projects : [];
    const idx = list.findIndex((p) => p.id === projectId);
    if (idx >= 0) {
      list[idx] = { ...list[idx], storage_ref: targetId };
      updated = list[idx];
      await writeLocalStore(REL, { ...doc, projects: list });
    }
  });

  return NextResponse.json(updated || { id: projectId, storage_ref: targetId });
});
