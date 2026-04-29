import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import {
  readProjectFile,
  writeProjectFile,
  withProjectLock,
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

  let updated = null;
  await withProjectLock(projectId, FILE, async () => {
    const data = await readProjectFile(projectId, FILE, EMPTY);
    const flows = Array.isArray(data?.flows) ? data.flows : [];
    const idx = flows.findIndex((f) => f && f.id === id);
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
    const next = flows.filter((f) => !(f && f.id === id));
    if (next.length === flows.length) return;
    removed = true;
    await writeProjectFile(projectId, FILE, { flows: next });
  });

  if (!removed) {
    return bad('errors.flow_not_found', 'flow not found', 404, { id });
  }
  return NextResponse.json({ id });
});
