import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { withAuth } from '@/lib/auth';
import { readStore, writeStore, withStoreLock } from '@/lib/storage';
import { DEFAULT_PROJECT_ID, migrateList } from '@/lib/projectScope';

const REL = 'data/groups.json';
const EMPTY = { groups: [] };

async function readGroups() {
  const data = await readStore(REL, EMPTY);
  const list = Array.isArray(data?.groups) ? data.groups : [];
  const { list: migrated, changed } = migrateList(list);
  if (changed) {
    await withStoreLock(REL, async () => {
      const fresh = await readStore(REL, EMPTY);
      const freshList = Array.isArray(fresh?.groups) ? fresh.groups : [];
      const { list: freshMigrated, changed: stillChanged } = migrateList(freshList);
      if (stillChanged) await writeStore(REL, { groups: freshMigrated });
    });
  }
  return migrated;
}

function normalize(list) {
  const now = new Date().toISOString();
  return list.map((g) => ({
    id: g.id || `gid-${randomUUID()}`,
    name: String(g.name ?? '').trim(),
    created_at: g.created_at || now,
    hidden: g.hidden === true,
    project_id: (typeof g.project_id === 'string' && g.project_id) ? g.project_id : DEFAULT_PROJECT_ID,
  }));
}

export const GET = withAuth(async () => {
  const groups = await readGroups();
  return NextResponse.json({ groups });
});

export const PUT = withAuth(async (req) => {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ detail: 'Invalid JSON', detail_key: 'errors.invalid_body' }, { status: 400 });
  }
  if (!body || !Array.isArray(body.groups)) {
    return NextResponse.json({ detail: 'Expected { groups: [...] }', detail_key: 'errors.invalid_body' }, { status: 400 });
  }
  const groups = await withStoreLock(REL, async () => {
    const next = normalize(body.groups);
    await writeStore(REL, { groups: next });
    return next;
  });
  return NextResponse.json({ groups });
});
