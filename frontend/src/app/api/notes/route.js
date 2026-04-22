import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { readJsonFile, writeJsonFileAtomic, withFileLock } from '@/lib/jsonStore';
import { withAuth } from '@/lib/auth';
import {
  DEFAULT_COLOR, DEFAULT_WIDTH, DEFAULT_HEIGHT,
  INITIAL_X, INITIAL_Y, isValidColor,
  TITLE_MAX, CONTENT_MAX, MIN_WIDTH, MIN_HEIGHT, MAX_WIDTH, MAX_HEIGHT, MAX_COORD,
} from '@/lib/notesConfig';
import { DEFAULT_PROJECT_ID, migrateList } from '@/lib/projectScope';

const REL = 'data/notes.json';
const LOCK_KEY = 'data/notes.json';
const EMPTY = { notes: [], updated_at: null };

async function readAndMigrate() {
  const data = await readJsonFile(REL, EMPTY);
  const list = Array.isArray(data?.notes) ? data.notes : [];
  const { list: migrated, changed } = migrateList(list);
  if (changed) {
    await withFileLock(LOCK_KEY, async () => {
      const fresh = await readJsonFile(REL, EMPTY);
      const freshList = Array.isArray(fresh?.notes) ? fresh.notes : [];
      const { list: freshMigrated, changed: stillChanged } = migrateList(freshList);
      if (stillChanged) {
        await writeJsonFileAtomic(REL, { notes: freshMigrated, updated_at: fresh?.updated_at ?? new Date().toISOString() });
      }
    });
  }
  return { notes: migrated, updated_at: data?.updated_at ?? null };
}

function bad(detailKey, detail, status = 400, params = null) {
  const body = { detail, detail_key: detailKey };
  if (params) body.detail_params = params;
  return NextResponse.json(body, { status });
}

function inRange(n, min, max) {
  return Number.isFinite(n) && n >= min && n <= max;
}

export const GET = withAuth(async () => {
  const data = await readAndMigrate();
  return NextResponse.json(data);
});

export const POST = withAuth(async (req) => {
  let body;
  try { body = await req.json(); } catch {
    return bad('errors.invalid_body', 'Invalid JSON');
  }

  const title = typeof body?.title === 'string' ? body.title : '';
  const content = typeof body?.content === 'string' ? body.content : '';
  if (title.length > TITLE_MAX) {
    return bad('errors.note_title_too_long', 'Title too long', 400, { max: TITLE_MAX });
  }
  if (content.length > CONTENT_MAX) {
    return bad('errors.note_content_too_long', 'Content too long', 400, { max: CONTENT_MAX });
  }

  const w = Number.isFinite(body?.w) ? body.w : DEFAULT_WIDTH;
  const h = Number.isFinite(body?.h) ? body.h : DEFAULT_HEIGHT;
  const x = Number.isFinite(body?.x) ? body.x : INITIAL_X;
  const y = Number.isFinite(body?.y) ? body.y : INITIAL_Y;
  if (!inRange(w, MIN_WIDTH, MAX_WIDTH) || !inRange(h, MIN_HEIGHT, MAX_HEIGHT)
      || !inRange(x, 0, MAX_COORD) || !inRange(y, 0, MAX_COORD)) {
    return bad('errors.note_invalid_geometry', 'Invalid geometry');
  }

  const color = isValidColor(body?.color) ? body.color : DEFAULT_COLOR;

  const now = new Date().toISOString();
  const note = await withFileLock(LOCK_KEY, async () => {
    const data = await readAndMigrate();
    const notes = data.notes;
    const created = {
      id: `note-${randomUUID()}`,
      title, content, color,
      x, y, w, h,
      pinned: body?.pinned === true,
      open: body?.open !== false,
      created_at: now,
      updated_at: now,
      project_id: (typeof body?.project_id === 'string' && body.project_id) ? body.project_id : DEFAULT_PROJECT_ID,
    };
    notes.push(created);
    await writeJsonFileAtomic(REL, { notes, updated_at: now });
    return created;
  });
  return NextResponse.json(note, { status: 201 });
});
