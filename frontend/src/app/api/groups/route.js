import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { withAuth } from '@/lib/auth';
import { withFileLock } from '@/lib/jsonStore';
import { DEFAULT_PROJECT_ID, migrateList } from '@/lib/projectScope';

const FILE = path.join(process.cwd(), 'data', 'groups.json');
const LOCK_KEY = 'data/groups.json';

async function readGroups() {
  try {
    const raw = await fs.readFile(FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed?.groups) ? parsed.groups : [];
    const { list: migrated, changed } = migrateList(list);
    if (changed) {
      await withFileLock(LOCK_KEY, async () => {
        // re-read inside lock to confirm migration is still needed
        try {
          const raw2 = await fs.readFile(FILE, 'utf-8');
          const parsed2 = JSON.parse(raw2);
          const list2 = Array.isArray(parsed2?.groups) ? parsed2.groups : [];
          const { list: migrated2, changed: changed2 } = migrateList(list2);
          if (changed2) await atomicWrite(migrated2);
        } catch {}
      });
    }
    return migrated;
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function atomicWrite(groups) {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify({ groups }, null, 2), 'utf-8');
    await fs.rename(tmp, FILE);
  } catch (err) {
    await fs.unlink(tmp).catch(() => {});
    throw err;
  }
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
  const groups = await withFileLock(LOCK_KEY, async () => {
    const next = normalize(body.groups);
    await atomicWrite(next);
    return next;
  });
  return NextResponse.json({ groups });
});
