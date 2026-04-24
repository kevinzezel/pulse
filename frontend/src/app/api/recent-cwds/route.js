import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { readStore, writeStore, withStoreLock } from '@/lib/storage';

const REL = 'data/recent-cwds.json';
const EMPTY = { servers: {} };
// Alterar = editar este arquivo + rebuild. Sem override por env (decisão do user).
const RECENT_CWDS_MAX = 100;

// Fixed locale ('en') keeps sort order reproducible across hosts whose
// LANG/LC_ALL differ (containers often have different defaults than dev
// machines). 'numeric' makes proj1 / proj2 / proj10 sort naturally.
const PATH_COLLATOR = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

function sortAlphaPaths(paths) {
  return [...paths].sort((a, b) => PATH_COLLATOR.compare(a.path, b.path));
}

function readServerEntry(data, serverId) {
  const entry = data.servers[serverId];
  return Array.isArray(entry?.paths) ? entry.paths : [];
}

export const GET = withAuth(async (req) => {
  const { searchParams } = new URL(req.url);
  const serverId = searchParams.get('serverId');
  if (!serverId) {
    return NextResponse.json(
      { detail: 'serverId required', detail_key: 'errors.invalid_body' },
      { status: 400 }
    );
  }
  const data = await readStore(REL, EMPTY);
  const paths = readServerEntry(data, serverId);
  return NextResponse.json({ paths: sortAlphaPaths(paths).map((p) => p.path) });
});

export const POST = withAuth(async (req) => {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { detail: 'Invalid JSON', detail_key: 'errors.invalid_body' },
      { status: 400 }
    );
  }
  const serverId = typeof body?.serverId === 'string' ? body.serverId : '';
  const path = typeof body?.path === 'string' ? body.path.trim() : '';
  if (!serverId || !path) {
    return NextResponse.json(
      { detail: 'serverId and path required', detail_key: 'errors.invalid_body' },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();
  const updated = await withStoreLock(REL, async () => {
    const data = await readStore(REL, EMPTY);
    const servers = { ...data.servers };
    const existing = readServerEntry(data, serverId);
    // Dedupe by path; refresh last_used_at if it already exists.
    const filtered = existing.filter((p) => p.path !== path);
    const next = [{ path, last_used_at: now }, ...filtered];
    // On-disk order isn't guaranteed to be LRU (legacy edits, manual changes),
    // so sort explicitly by last_used_at desc before truncating to ensure the
    // oldest entry is the one dropped — not whatever happens to be at the end.
    if (next.length > RECENT_CWDS_MAX) {
      next.sort((a, b) =>
        String(b.last_used_at || '').localeCompare(String(a.last_used_at || ''))
      );
      next.length = RECENT_CWDS_MAX;
    }
    servers[serverId] = { paths: next };
    await writeStore(REL, { servers });
    return next;
  });

  return NextResponse.json({ paths: sortAlphaPaths(updated).map((p) => p.path) });
});

export const DELETE = withAuth(async (req) => {
  const { searchParams } = new URL(req.url);
  const serverId = searchParams.get('serverId');
  const path = searchParams.get('path');
  if (!serverId || !path) {
    return NextResponse.json(
      { detail: 'serverId and path required', detail_key: 'errors.invalid_body' },
      { status: 400 }
    );
  }

  const updated = await withStoreLock(REL, async () => {
    const data = await readStore(REL, EMPTY);
    const servers = { ...data.servers };
    const existing = readServerEntry(data, serverId);
    const next = existing.filter((p) => p.path !== path);
    if (next.length === existing.length) return next; // No-op: not found.
    servers[serverId] = { paths: next };
    await writeStore(REL, { servers });
    return next;
  });

  return NextResponse.json({ paths: sortAlphaPaths(updated).map((p) => p.path) });
});
