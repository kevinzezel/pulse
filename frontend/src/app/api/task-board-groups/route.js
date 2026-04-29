import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { withAuth } from '@/lib/auth';
import {
  readProjectFile,
  writeProjectFile,
  withProjectLock,
} from '@/lib/projectStorage';

const FILE = 'task-board-groups.json';
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

// Stamp shape defaults on the way out so a hand-edited file or a new client
// never trips on a missing field. Rows explicitly marked as another project
// are contamination and must not be restamped into the current project.
function normalizeGroups(list, projectId) {
  const now = new Date().toISOString();
  return (Array.isArray(list) ? list : [])
    .filter((g) => (
      g
      && (
        typeof g.project_id !== 'string'
        || !g.project_id
        || g.project_id === projectId
      )
    ))
    .map((g) => ({
      id: (typeof g?.id === 'string' && g.id) ? g.id : `tbg-${randomUUID()}`,
      name: String(g?.name ?? '').trim(),
      created_at: g?.created_at || now,
      updated_at: g?.updated_at || now,
      hidden: g?.hidden === true,
      project_id: projectId,
    }));
}

export const GET = withAuth(async (req) => {
  const projectId = getProjectId(req);
  if (!projectId) {
    return bad('errors.invalid_body', 'project_id query param is required', 400);
  }
  try {
    const data = await readProjectFile(projectId, FILE, EMPTY);
    const groups = normalizeGroups(data?.groups, projectId);
    return NextResponse.json({ groups });
  } catch (err) {
    if (/unknown project/i.test(err?.message || '')) {
      return bad('errors.project_not_found', 'project not found', 404, { project_id: projectId });
    }
    throw err;
  }
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

  try {
    const created = await withProjectLock(projectId, FILE, async () => {
      const data = await readProjectFile(projectId, FILE, EMPTY);
      const groups = Array.isArray(data?.groups) ? data.groups : [];
      const now = new Date().toISOString();
      const group = {
        id: `tbg-${randomUUID()}`,
        name: body.name.trim(),
        created_at: now,
        updated_at: now,
        hidden: false,
        project_id: projectId,
      };
      groups.push(group);
      await writeProjectFile(projectId, FILE, { groups });
      return group;
    });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    if (/unknown project/i.test(err?.message || '')) {
      return bad('errors.project_not_found', 'project not found', 404, { project_id: projectId });
    }
    throw err;
  }
});

// PUT replaces the whole array — used for reorder / rename / hide. Last-writer-wins.
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
  const next = normalizeGroups(body.groups, projectId);
  await withProjectLock(projectId, FILE, async () => {
    await writeProjectFile(projectId, FILE, { groups: next });
  });
  return NextResponse.json({ groups: next });
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
    return bad('errors.task_board_group_not_found', 'task board group not found', 404, { id });
  }
  return NextResponse.json({ id });
});
