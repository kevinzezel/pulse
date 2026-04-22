import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { withAuth } from '@/lib/auth';
import { withFileLock } from '@/lib/jsonStore';

const FILE = path.join(process.cwd(), 'data', 'view-state.json');
const LOCK_KEY = 'data/view-state.json';

async function readViewState() {
  try {
    const raw = await fs.readFile(FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    const vs = parsed?.view_state;
    if (!vs || typeof vs !== 'object' || Array.isArray(vs)) return {};
    return normalize(vs);
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

async function atomicWrite(viewState) {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify({ view_state: viewState }, null, 2), 'utf-8');
    await fs.rename(tmp, FILE);
  } catch (err) {
    await fs.unlink(tmp).catch(() => {});
    throw err;
  }
}

function normalize(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof key !== 'string' || !key) continue;
    if (value === undefined || value === null) {
      out[key] = null;
    } else if (typeof value === 'string') {
      out[key] = value;
    }
  }
  return out;
}

export const GET = withAuth(async () => {
  const viewState = await readViewState();
  return NextResponse.json({ view_state: viewState });
});

export const PUT = withAuth(async (req) => {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ detail: 'Invalid JSON', detail_key: 'errors.invalid_body' }, { status: 400 });
  }
  if (!body || typeof body.view_state !== 'object' || Array.isArray(body.view_state)) {
    return NextResponse.json({ detail: 'Expected { view_state: {...} }', detail_key: 'errors.invalid_body' }, { status: 400 });
  }
  const viewState = await withFileLock(LOCK_KEY, async () => {
    const next = normalize(body.view_state);
    await atomicWrite(next);
    return next;
  });
  return NextResponse.json({ view_state: viewState });
});
