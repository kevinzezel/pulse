import { NextResponse } from 'next/server';
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

export const PATCH = withAuth(async (req, { params }) => {
  const { id } = await params;
  const projectId = getProjectId(req);
  if (!projectId) {
    return bad('errors.invalid_body', 'project_id query param is required', 400);
  }
  let patch;
  try { patch = await req.json(); } catch { return bad('errors.invalid_body', 'Invalid JSON'); }
  if (!patch || typeof patch !== 'object') {
    return bad('errors.invalid_body', 'Expected object body');
  }

  let updated = null;
  await withProjectLock(projectId, FILE, async () => {
    const data = await readProjectFile(projectId, FILE, EMPTY);
    const notes = Array.isArray(data?.notes) ? data.notes : [];
    const idx = notes.findIndex((n) => n && n.id === id);
    if (idx < 0) return;
    const now = new Date().toISOString();
    notes[idx] = { ...notes[idx], ...patch, id, project_id: projectId, updated_at: now };
    updated = notes[idx];
    await writeProjectFile(projectId, FILE, { notes });
  });

  if (!updated) {
    return bad('errors.note_not_found', 'note not found', 404, { id });
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
    const notes = Array.isArray(data?.notes) ? data.notes : [];
    const next = notes.filter((n) => !(n && n.id === id));
    if (next.length === notes.length) return;
    removed = true;
    await writeProjectFile(projectId, FILE, { notes: next });
  });

  if (!removed) {
    return bad('errors.note_not_found', 'note not found', 404, { id });
  }
  return NextResponse.json({ id });
});
