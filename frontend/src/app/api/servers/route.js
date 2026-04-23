import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { withAuth } from '@/lib/auth';
import { readStore, writeStore, withStoreLock } from '@/lib/storage';

const REL = 'data/servers.json';
const EMPTY = { servers: [] };

async function readServers() {
  const data = await readStore(REL, EMPTY);
  return Array.isArray(data?.servers) ? data.servers : [];
}

function normalize(list) {
  const now = new Date().toISOString();
  return list.map((s) => {
    const host = String(s.host ?? '').trim();
    const name = String(s.name ?? '').trim();
    const apiKey = String(s.apiKey ?? '');
    const portRaw = Number(s.port);
    const port = Number.isFinite(portRaw) && portRaw >= 1 && portRaw <= 65535
      ? Math.floor(portRaw)
      : 8000;
    return {
      id: s.id || `srv-${randomUUID()}`,
      name,
      protocol: s.protocol === 'https' ? 'https' : 'http',
      host,
      port,
      apiKey,
      color: s.color ? String(s.color) : null,
      createdAt: s.createdAt || now,
    };
  });
}

export const GET = withAuth(async () => {
  const servers = await readServers();
  return NextResponse.json({ servers });
});

export const PUT = withAuth(async (req) => {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ detail: 'Invalid JSON', detail_key: 'errors.invalid_body' }, { status: 400 });
  }
  if (!body || !Array.isArray(body.servers)) {
    return NextResponse.json({ detail: 'Expected { servers: [...] }', detail_key: 'errors.invalid_body' }, { status: 400 });
  }
  const servers = await withStoreLock(REL, async () => {
    const next = normalize(body.servers);
    await writeStore(REL, { servers: next });
    return next;
  });
  return NextResponse.json({ servers });
});
