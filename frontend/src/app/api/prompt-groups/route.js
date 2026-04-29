import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { withAuth } from '@/lib/auth';
import {
  readProjectFile,
  writeProjectFile,
  withProjectLock,
} from '@/lib/projectStorage';

const FILE = 'prompt-groups.json';
const EMPTY = { groups: [] };

function bad(detailKey, detail, status = 400, params) {
  const body = { detail, detail_key: detailKey };
  if (params) body.detail_params = params;
  return NextResponse.json(body, { status });
}

function getProjectId(req) {
  const url = new URL(req.url);
  const projectId = url.searchParams.get('project_id');
  const scope = url.searchParams.get('scope');
  if (scope === 'global') return null;
  if (typeof projectId === 'string' && projectId && projectId !== 'null') {
    return projectId;
  }
  return null;
}

function normalizeGroups(list, projectId) {
  const now = new Date().toISOString();
  return (Array.isArray(list) ? list : []).map((g) => ({
    id: (typeof g?.id === 'string' && g.id) ? g.id : `pgid-${randomUUID()}`,
    name: String(g?.name ?? '').trim(),
    project_id: projectId,
    created_at: g?.created_at || now,
    updated_at: g?.updated_at || now,
  }));
}

async function readProjectGroups(projectId) {
  return await readProjectFile(projectId, FILE, EMPTY);
}

async function writeProjectGroups(projectId, data) {
  return await writeProjectFile(projectId, FILE, data);
}

async function withProjectGroupsLock(projectId, fn) {
  return await withProjectLock(projectId, FILE, fn);
}

export const GET = withAuth(async (req) => {
  const projectId = getProjectId(req);
  if (!projectId) {
    return bad('errors.invalid_body', 'project_id query param is required', 400);
  }
  try {
    const data = await readProjectGroups(projectId);
    return NextResponse.json({ groups: normalizeGroups(data?.groups, projectId) });
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
  if (!body || typeof body !== 'object') {
    return bad('errors.invalid_body', 'Expected object body');
  }

  const created = await withProjectGroupsLock(projectId, async () => {
    const data = await readProjectGroups(projectId);
    const groups = Array.isArray(data?.groups) ? data.groups : [];
    const now = new Date().toISOString();
    const group = {
      id: `pgid-${randomUUID()}`,
      name: typeof body.name === 'string' ? body.name.trim() : '',
      project_id: projectId,
      created_at: now,
      updated_at: now,
    };
    groups.push(group);
    await writeProjectGroups(projectId, { groups: normalizeGroups(groups, projectId) });
    return group;
  });

  return NextResponse.json(created, { status: 201 });
});

// PUT replace: kept for reorder (drag-drop). Last-writer-wins.
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
  const groups = normalizeGroups(body.groups, projectId);
  await withProjectGroupsLock(projectId, async () => {
    await writeProjectGroups(projectId, { groups });
  });
  return NextResponse.json({ groups });
});

// Helpers exported for [id]/route.js — Next.js only treats GET/POST/PUT/PATCH/DELETE
// as HTTP method handlers; named-export helpers like these are ignored by the
// route scanner.
export {
  getProjectId as _getProjectId,
  readProjectGroups as _readProjectGroups,
  writeProjectGroups as _writeProjectGroups,
  withProjectGroupsLock as _withProjectGroupsLock,
};
