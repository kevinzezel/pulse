import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { withAuth } from '@/lib/auth';
import { readStore, writeStore, withStoreLock } from '@/lib/storage';
import { DEFAULT_PROJECT_ID, DEFAULT_PROJECT_NAME } from '@/lib/projectScope';

const REL = 'data/projects.json';

const NAME_MAX = 64;

function makeDefaultState() {
  const now = new Date().toISOString();
  return {
    projects: [
      { id: DEFAULT_PROJECT_ID, name: DEFAULT_PROJECT_NAME, is_default: true, created_at: now },
    ],
    active_project_id: DEFAULT_PROJECT_ID,
    updated_at: now,
  };
}

function normalizeState(parsed) {
  if (!parsed || typeof parsed !== 'object') return makeDefaultState();
  const projects = Array.isArray(parsed.projects) ? parsed.projects : [];
  const hasDefault = projects.some((p) => p && p.is_default === true);
  const normalized = {
    projects: projects
      .map((p) => ({
        id: (typeof p.id === 'string' && p.id) ? p.id : `proj-${randomUUID()}`,
        name: String(p?.name ?? '').trim() || DEFAULT_PROJECT_NAME,
        is_default: p?.is_default === true,
        created_at: p?.created_at || new Date().toISOString(),
      }))
      .filter((p) => p.name.length > 0),
    active_project_id: (typeof parsed.active_project_id === 'string' && parsed.active_project_id) || DEFAULT_PROJECT_ID,
    updated_at: parsed.updated_at || new Date().toISOString(),
  };
  if (!hasDefault) {
    const now = new Date().toISOString();
    normalized.projects.unshift({
      id: DEFAULT_PROJECT_ID,
      name: DEFAULT_PROJECT_NAME,
      is_default: true,
      created_at: now,
    });
  }
  if (!normalized.projects.some((p) => p.id === normalized.active_project_id)) {
    const def = normalized.projects.find((p) => p.is_default) || normalized.projects[0];
    normalized.active_project_id = def.id;
  }
  return normalized;
}

async function readState() {
  const data = await readStore(REL, null);
  if (!data) {
    return withStoreLock(REL, async () => {
      const fresh = await readStore(REL, null);
      if (fresh) return normalizeState(fresh);
      const seed = makeDefaultState();
      await writeStore(REL, seed);
      return seed;
    });
  }
  return normalizeState(data);
}

function normalizePut(body) {
  const now = new Date().toISOString();
  const incoming = Array.isArray(body?.projects) ? body.projects : [];
  const seen = new Set();
  const projects = [];
  for (const p of incoming) {
    const id = (typeof p?.id === 'string' && p.id) ? p.id : `proj-${randomUUID()}`;
    if (seen.has(id)) continue;
    const name = String(p?.name ?? '').trim();
    if (!name) continue;
    if (name.length > NAME_MAX) continue;
    seen.add(id);
    projects.push({
      id,
      name,
      is_default: p?.is_default === true,
      created_at: p?.created_at || now,
    });
  }
  const defaults = projects.filter((p) => p.is_default);
  if (defaults.length === 0) {
    const first = projects[0];
    if (first) first.is_default = true;
    else projects.push({ id: DEFAULT_PROJECT_ID, name: DEFAULT_PROJECT_NAME, is_default: true, created_at: now });
  } else if (defaults.length > 1) {
    let kept = false;
    for (const p of projects) {
      if (p.is_default) {
        if (kept) p.is_default = false;
        else kept = true;
      }
    }
  }
  let active_project_id = typeof body?.active_project_id === 'string' ? body.active_project_id : null;
  if (!projects.some((p) => p.id === active_project_id)) {
    const def = projects.find((p) => p.is_default) || projects[0];
    active_project_id = def.id;
  }
  return { projects, active_project_id, updated_at: now };
}

export const GET = withAuth(async () => {
  const state = await readState();
  return NextResponse.json(state);
});

export const PUT = withAuth(async (req) => {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ detail: 'Invalid JSON', detail_key: 'errors.invalid_body' }, { status: 400 });
  }
  if (!body || !Array.isArray(body.projects)) {
    return NextResponse.json({ detail: 'Expected { projects: [...] }', detail_key: 'errors.invalid_body' }, { status: 400 });
  }
  const state = await withStoreLock(REL, async () => {
    const next = normalizePut(body);
    await writeStore(REL, next);
    return next;
  });
  return NextResponse.json(state);
});
