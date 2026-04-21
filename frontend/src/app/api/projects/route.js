import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { withAuth } from '@/lib/auth';
import { withFileLock } from '@/lib/jsonStore';
import { DEFAULT_PROJECT_ID, DEFAULT_PROJECT_NAME } from '@/lib/projectScope';

const FILE = path.join(process.cwd(), 'data', 'projects.json');
const LOCK_KEY = 'data/projects.json';

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

async function readState() {
  try {
    const raw = await fs.readFile(FILE, 'utf-8');
    const parsed = JSON.parse(raw);
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
  } catch (err) {
    if (err.code === 'ENOENT') {
      return withFileLock(LOCK_KEY, async () => {
        try {
          const raw = await fs.readFile(FILE, 'utf-8');
          return JSON.parse(raw);
        } catch (err2) {
          if (err2.code !== 'ENOENT') throw err2;
          const seed = makeDefaultState();
          await atomicWrite(seed);
          return seed;
        }
      });
    }
    throw err;
  }
}

async function atomicWrite(state) {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(state, null, 2), 'utf-8');
    await fs.rename(tmp, FILE);
  } catch (err) {
    await fs.unlink(tmp).catch(() => {});
    throw err;
  }
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
  const state = await withFileLock(LOCK_KEY, async () => {
    const next = normalizePut(body);
    await atomicWrite(next);
    return next;
  });
  return NextResponse.json(state);
});
