import { NextResponse } from 'next/server';
import { readJsonFile, writeJsonFileAtomic, withFileLock } from '@/lib/jsonStore';
import { withAuth } from '@/lib/auth';
import {
  isValidColor,
  TITLE_MAX, CONTENT_MAX,
  MIN_WIDTH, MIN_HEIGHT, MAX_WIDTH, MAX_HEIGHT, MAX_COORD,
} from '@/lib/notesConfig';

const REL = 'data/notes.json';
const LOCK_KEY = 'data/notes.json';
const EMPTY = { notes: [], updated_at: null };

function bad(detailKey, detail, status = 400, params = null) {
  const body = { detail, detail_key: detailKey };
  if (params) body.detail_params = params;
  return NextResponse.json(body, { status });
}

const GEOMETRY_BOUNDS = {
  w: [MIN_WIDTH, MAX_WIDTH],
  h: [MIN_HEIGHT, MAX_HEIGHT],
  x: [0, MAX_COORD],
  y: [0, MAX_COORD],
};

function throwAppError(key, status = 400, params = null) {
  const err = new Error(key);
  err.key = key;
  err.status = status;
  if (params) err.params = params;
  throw err;
}

function applyPatch(note, patch) {
  const out = { ...note };
  if (typeof patch.title === 'string') {
    if (patch.title.length > TITLE_MAX) throwAppError('errors.note_title_too_long', 400, { max: TITLE_MAX });
    out.title = patch.title;
  }
  if (typeof patch.content === 'string') {
    if (patch.content.length > CONTENT_MAX) throwAppError('errors.note_content_too_long', 400, { max: CONTENT_MAX });
    out.content = patch.content;
  }
  if (patch.color !== undefined) {
    if (!isValidColor(patch.color)) throwAppError('errors.note_invalid_color');
    out.color = patch.color;
  }
  for (const [k, [min, max]] of Object.entries(GEOMETRY_BOUNDS)) {
    if (patch[k] !== undefined) {
      if (!Number.isFinite(patch[k]) || patch[k] < min || patch[k] > max) {
        throwAppError('errors.note_invalid_geometry');
      }
      out[k] = patch[k];
    }
  }
  for (const k of ['pinned', 'open']) {
    if (patch[k] !== undefined) out[k] = patch[k] === true;
  }
  out.updated_at = new Date().toISOString();
  return out;
}

export const PATCH = withAuth(async (req, { params }) => {
  const { id } = await params;
  let body;
  try { body = await req.json(); } catch {
    return bad('errors.invalid_body', 'Invalid JSON');
  }
  let result;
  try {
    result = await withFileLock(LOCK_KEY, async () => {
      const data = await readJsonFile(REL, EMPTY);
      const notes = Array.isArray(data?.notes) ? data.notes : [];
      const idx = notes.findIndex((n) => n.id === id);
      if (idx < 0) return { notFound: true };
      const updated = applyPatch(notes[idx], body);
      notes[idx] = updated;
      await writeJsonFileAtomic(REL, { notes, updated_at: updated.updated_at });
      return { updated };
    });
  } catch (err) {
    return bad(err.key || 'errors.invalid_body', err.message, err.status || 400, err.params || null);
  }
  if (result.notFound) return bad('errors.note_not_found', 'Note not found', 404);
  return NextResponse.json(result.updated);
});

export const DELETE = withAuth(async (req, { params }) => {
  const { id } = await params;
  const result = await withFileLock(LOCK_KEY, async () => {
    const data = await readJsonFile(REL, EMPTY);
    const notes = Array.isArray(data?.notes) ? data.notes : [];
    const idx = notes.findIndex((n) => n.id === id);
    if (idx < 0) return { notFound: true };
    notes.splice(idx, 1);
    await writeJsonFileAtomic(REL, { notes, updated_at: new Date().toISOString() });
    return { ok: true };
  });
  if (result.notFound) return bad('errors.note_not_found', 'Note not found', 404);
  return NextResponse.json({ ok: true });
});
