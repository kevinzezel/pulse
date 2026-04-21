import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { withAuth } from '@/lib/auth';
import { withFileLock } from '@/lib/jsonStore';

const FILE = path.join(process.cwd(), 'data', 'servers.json');
const LOCK_KEY = 'data/servers.json';

async function readServers() {
  try {
    const raw = await fs.readFile(FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.servers) ? parsed.servers : [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function atomicWrite(servers) {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify({ servers }, null, 2), 'utf-8');
    await fs.rename(tmp, FILE);
  } catch (err) {
    await fs.unlink(tmp).catch(() => {});
    throw err;
  }
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
  const servers = await withFileLock(LOCK_KEY, async () => {
    const next = normalize(body.servers);
    await atomicWrite(next);
    return next;
  });
  return NextResponse.json({ servers });
});
