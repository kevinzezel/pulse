import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import {
  readProjectFile,
  writeProjectFile,
  withProjectLock,
  validateGroupBelongsToProject,
  recordBelongsToProject,
} from '@/lib/projectStorage';

const FILE = 'flows.json';
const EMPTY = { flows: [] };

function bad(detailKey, detail, status = 400, params) {
  const body = { detail, detail_key: detailKey };
  if (params) body.detail_params = params;
  return NextResponse.json(body, { status });
}

function getProjectId(req) {
  const url = new URL(req.url);
  return url.searchParams.get('project_id');
}

export const PATCH = withAuth(async (req, { params }) => {
  const { id } = await params;
  const projectId = getProjectId(req);
  if (!projectId) {
    return bad('errors.invalid_body', 'project_id query param is required', 400);
  }
  let patch;
  try {
    patch = await req.json();
  } catch {
    return bad('errors.invalid_body', 'Invalid JSON', 400);
  }
  if (!patch || typeof patch !== 'object') {
    return bad('errors.invalid_body', 'Expected object body', 400);
  }

  // Cross-project group leak guard: only relevant when the patch touches
  // group_id. Skipping the check when group_id isn't in the patch keeps
  // hot paths (scene autosave, rename, pin toggle) from reading the
  // flow-groups file on every keystroke.
  if (Object.prototype.hasOwnProperty.call(patch, 'group_id')) {
    const groupErr = await validateGroupBelongsToProject(projectId, 'flow-groups.json', patch.group_id ?? null);
    if (groupErr) return bad(groupErr.detailKey, groupErr.detail, 400, groupErr.params);
  }

  let updated = null;
  await withProjectLock(projectId, FILE, async () => {
    const data = await readProjectFile(projectId, FILE, EMPTY);
    const flows = Array.isArray(data?.flows) ? data.flows : [];
    const idx = flows.findIndex((f) => f && f.id === id && recordBelongsToProject(f, projectId));
    if (idx < 0) return;
    const now = new Date().toISOString();
    flows[idx] = { ...flows[idx], ...patch, id, project_id: projectId, updated_at: now };
    updated = flows[idx];
    await writeProjectFile(projectId, FILE, { flows });
  });

  if (!updated) {
    return bad('errors.flow_not_found', 'flow not found', 404, { id });
  }
  return NextResponse.json(updated);
});

export const DELETE = withAuth(async (req, { params }) => {
  const { id } = await params;
  const projectId = getProjectId(req);
  if (!projectId) {
    return bad('errors.invalid_body', 'project_id query param is required', 400);
  }

  let removed = false;
  await withProjectLock(projectId, FILE, async () => {
    const data = await readProjectFile(projectId, FILE, EMPTY);
    const flows = Array.isArray(data?.flows) ? data.flows : [];
    const next = flows.filter((f) => !(f && f.id === id && recordBelongsToProject(f, projectId)));
    if (next.length === flows.length) return;
    removed = true;
    await writeProjectFile(projectId, FILE, { flows: next });
  });

  if (!removed) {
    return bad('errors.flow_not_found', 'flow not found', 404, { id });
  }
  return NextResponse.json({ id });
});
