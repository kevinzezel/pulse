import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { withAuth } from '@/lib/auth';
import {
  readProjectFile,
  writeProjectFile,
  withProjectLock,
} from '@/lib/projectStorage';

const FILE = 'flow-groups.json';
const EMPTY = { groups: [] };

function bad(detailKey, detail, status = 400, params) {
  const body = { detail, detail_key: detailKey };
  if (params) body.detail_params = params;
  return NextResponse.json(body, { status });
}

function getProjectId(req) {
  const url = new URL(req.url);
  return url.searchParams.get('project_id');
}

export const GET = withAuth(async (req) => {
  const projectId = getProjectId(req);
  if (!projectId) {
    return bad('errors.invalid_body', 'project_id query param is required', 400);
  }
  const data = await readProjectFile(projectId, FILE, EMPTY);
  return NextResponse.json({ groups: Array.isArray(data?.groups) ? data.groups : [] });
});

export const POST = withAuth(async (req) => {
  const projectId = getProjectId(req);
  if (!projectId) {
    return bad('errors.invalid_body', 'project_id query param is required', 400);
  }
  let body;
  try { body = await req.json(); } catch { return bad('errors.invalid_body', 'Invalid JSON'); }
  if (!body || typeof body.name !== 'string' || !body.name.trim()) {
    return bad('errors.invalid_body', 'name is required');
  }

  const created = await withProjectLock(projectId, FILE, async () => {
    const data = await readProjectFile(projectId, FILE, EMPTY);
    const groups = Array.isArray(data?.groups) ? data.groups : [];
    const now = new Date().toISOString();
    const group = {
      id: `fgid-${randomUUID()}`,
      name: body.name.trim(),
      created_at: now,
      hidden: false,
      project_id: projectId,
    };
    groups.push(group);
    await writeProjectFile(projectId, FILE, { groups });
    return group;
  });

  return NextResponse.json(created, { status: 201 });
});

// PUT replaces the whole array — used for reorder. Last-writer-wins.
export const PUT = withAuth(async (req) => {
  const projectId = getProjectId(req);
  if (!projectId) {
    return bad('errors.invalid_body', 'project_id query param is required', 400);
  }
  let body;
  try { body = await req.json(); } catch { return bad('errors.invalid_body', 'Invalid JSON'); }
  if (!body || !Array.isArray(body.groups)) {
    return bad('errors.invalid_body', 'Expected { groups: [...] }');
  }
  await withProjectLock(projectId, FILE, async () => {
    await writeProjectFile(projectId, FILE, { groups: body.groups });
  });
  return NextResponse.json({ groups: body.groups });
});

export const DELETE = withAuth(async (req) => {
  const projectId = getProjectId(req);
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!projectId) {
    return bad('errors.invalid_body', 'project_id query param is required', 400);
  }
  if (!id) {
    return bad('errors.invalid_body', 'id query param is required', 400);
  }

  let removed = false;
  await withProjectLock(projectId, FILE, async () => {
    const data = await readProjectFile(projectId, FILE, EMPTY);
    const groups = Array.isArray(data?.groups) ? data.groups : [];
    const next = groups.filter((g) => !(g && g.id === id));
    if (next.length === groups.length) return;
    removed = true;
    await writeProjectFile(projectId, FILE, { groups: next });
  });
  if (!removed) {
    return bad('errors.flow_group_not_found', 'flow group not found', 404, { id });
  }
  return NextResponse.json({ id });
});
