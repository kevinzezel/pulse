import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { withAuth } from '@/lib/auth';
import { readLocalStore, writeLocalStore, withLocalStoreLock } from '@/lib/projectStorage';

const REL = 'data/groups.json';
const EMPTY = { groups: [] };

async function readGroups() {
  const data = await readLocalStore(REL, EMPTY);
  return Array.isArray(data?.groups) ? data.groups : [];
}

// Groups carry an optional `project_id`. Pre-v4.2 records may have a
// `proj-default` stub; we pass it through so existing rows aren't dropped,
// but new groups always come with a real id from the active selector
// because the OnboardingGate guarantees at least one project before any UI
// can fire group creation.
function normalize(list) {
  const now = new Date().toISOString();
  return list.map((g) => {
    const out = {
      id: g.id || `gid-${randomUUID()}`,
      name: String(g.name ?? '').trim(),
      created_at: g.created_at || now,
      hidden: g.hidden === true,
    };
    if (typeof g.project_id === 'string' && g.project_id) out.project_id = g.project_id;
    return out;
  });
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
  const groups = await withLocalStoreLock(REL, async () => {
    const next = normalize(body.groups);
    await writeLocalStore(REL, { groups: next });
    return next;
  });
  return NextResponse.json({ groups });
});
