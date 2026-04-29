import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { withAuth } from '@/lib/auth';
import {
  readProjectFile,
  writeProjectFile,
  withProjectLock,
} from '@/lib/projectStorage';

const FILE = 'notes.json';
const EMPTY = { notes: [] };

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
  try {
    const data = await readProjectFile(projectId, FILE, EMPTY);
    return NextResponse.json({ notes: Array.isArray(data?.notes) ? data.notes : [] });
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

  const created = await withProjectLock(projectId, FILE, async () => {
    const data = await readProjectFile(projectId, FILE, EMPTY);
    const notes = Array.isArray(data?.notes) ? data.notes : [];
    const now = new Date().toISOString();
    const note = {
      id: `note-${randomUUID()}`,
      title: typeof body.title === 'string' ? body.title : '',
      content: typeof body.content === 'string' ? body.content : '',
      color: typeof body.color === 'string' ? body.color : 'yellow',
      x: Number.isFinite(body.x) ? body.x : 120,
      y: Number.isFinite(body.y) ? body.y : 100,
      w: Number.isFinite(body.w) ? body.w : 280,
      h: Number.isFinite(body.h) ? body.h : 220,
      pinned: !!body.pinned,
      open: !!body.open,
      created_at: now,
      updated_at: now,
      project_id: projectId,
    };
    notes.push(note);
    await writeProjectFile(projectId, FILE, { notes });
    return note;
  });

  return NextResponse.json(created, { status: 201 });
});

// PUT replace-array: kept for any existing callers (backwards compat).
// Last-writer-wins.
export const PUT = withAuth(async (req) => {
  const projectId = getProjectId(req);
  if (!projectId) {
    return bad('errors.invalid_body', 'project_id query param is required', 400);
  }
  let body;
  try { body = await req.json(); } catch { return bad('errors.invalid_body', 'Invalid JSON'); }
  if (!body || !Array.isArray(body.notes)) {
    return bad('errors.invalid_body', 'Expected { notes: [...] }');
  }
  await withProjectLock(projectId, FILE, async () => {
    await writeProjectFile(projectId, FILE, { notes: body.notes });
  });
  return NextResponse.json({ notes: body.notes });
});
