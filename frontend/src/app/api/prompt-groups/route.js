import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { withAuth } from '@/lib/auth';
import { readStore, writeStore, withStoreLock } from '@/lib/storage';

const REL = 'data/prompt-groups.json';
const EMPTY = { groups: [] };

async function readGroups() {
  const data = await readStore(REL, EMPTY);
  return Array.isArray(data?.groups) ? data.groups : [];
}

function normalize(list) {
  const now = new Date().toISOString();
  return list.map((g) => ({
    id: g.id || `pgid-${randomUUID()}`,
    name: String(g.name ?? '').trim(),
    created_at: g.created_at || now,
    updated_at: g.updated_at || now,
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
