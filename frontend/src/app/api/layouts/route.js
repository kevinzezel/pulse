import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { readStore, writeStore, withStoreLock } from '@/lib/storage';
import { DEFAULT_PROJECT_ID } from '@/lib/projectScope';

const REL = 'data/layouts.json';
const EMPTY = { layouts: {} };

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
  const data = await readStore(REL, EMPTY);
  const layouts = data?.layouts;
  if (!layouts || typeof layouts !== 'object' || Array.isArray(layouts)) return {};
  const { migrated, changed } = migrateLayouts(layouts);
  if (changed) {
    await withStoreLock(REL, async () => {
      const fresh = await readStore(REL, EMPTY);
      const freshLayouts = fresh?.layouts && typeof fresh.layouts === 'object' && !Array.isArray(fresh.layouts) ? fresh.layouts : {};
      const { migrated: migrated2, changed: changed2 } = migrateLayouts(freshLayouts);
      if (changed2) await writeStore(REL, { layouts: migrated2 });
    });
  }
  return migrated;
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
  const layouts = await withStoreLock(REL, async () => {
    const next = normalize(body.layouts);
    await writeStore(REL, { layouts: next });
    return next;
  });
  return NextResponse.json({ layouts });
});
