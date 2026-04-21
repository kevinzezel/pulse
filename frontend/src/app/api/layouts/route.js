import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { withAuth } from '@/lib/auth';
import { withFileLock } from '@/lib/jsonStore';
import { DEFAULT_PROJECT_ID } from '@/lib/projectScope';

const FILE = path.join(process.cwd(), 'data', 'layouts.json');
const LOCK_KEY = 'data/layouts.json';

function migrateLayouts(layouts) {
  let changed = false;
  const migrated = {};
  for (const [key, value] of Object.entries(layouts)) {
    if (typeof key !== 'string' || !key) continue;
    if (key.includes('::')) {
      migrated[key] = value;
    } else {
      migrated[`${DEFAULT_PROJECT_ID}::${key}`] = value;
      changed = true;
    }
  }
  return { migrated, changed };
}

async function readLayouts() {
  try {
    const raw = await fs.readFile(FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    const layouts = parsed?.layouts;
    if (!layouts || typeof layouts !== 'object' || Array.isArray(layouts)) return {};
    const { migrated, changed } = migrateLayouts(layouts);
    if (changed) {
      await withFileLock(LOCK_KEY, async () => {
        try {
          const raw2 = await fs.readFile(FILE, 'utf-8');
          const parsed2 = JSON.parse(raw2);
          const layouts2 = parsed2?.layouts && typeof parsed2.layouts === 'object' && !Array.isArray(parsed2.layouts) ? parsed2.layouts : {};
          const { migrated: migrated2, changed: changed2 } = migrateLayouts(layouts2);
          if (changed2) await atomicWrite(migrated2);
        } catch {}
      });
    }
    return migrated;
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

async function atomicWrite(layouts) {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify({ layouts }, null, 2), 'utf-8');
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
    out[key] = value === undefined ? null : value;
  }
  return out;
}

export const GET = withAuth(async () => {
  const layouts = await readLayouts();
  return NextResponse.json({ layouts });
});

export const PUT = withAuth(async (req) => {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ detail: 'Invalid JSON', detail_key: 'errors.invalid_body' }, { status: 400 });
  }
  if (!body || typeof body.layouts !== 'object' || Array.isArray(body.layouts)) {
    return NextResponse.json({ detail: 'Expected { layouts: {...} }', detail_key: 'errors.invalid_body' }, { status: 400 });
  }
  const layouts = await withFileLock(LOCK_KEY, async () => {
    const next = normalize(body.layouts);
    await atomicWrite(next);
    return next;
  });
  return NextResponse.json({ layouts });
});
