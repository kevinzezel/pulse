import { NextResponse } from 'next/server';
import { readStore, writeStore, withStoreLock } from '@/lib/storage';
import { withAuth } from '@/lib/auth';
import { DEFAULT_PROJECT_ID } from '@/lib/projectScope';

const REL = 'data/sessions.json';
const EMPTY = { servers: {}, updated_at: null };

function normalizeSession(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!id) return null;
  const out = { id };
  if (typeof raw.name === 'string') out.name = raw.name;
  out.group_id = (typeof raw.group_id === 'string' && raw.group_id) ? raw.group_id : null;
  if (typeof raw.group_name === 'string') out.group_name = raw.group_name;
  out.notify_on_idle = Boolean(raw.notify_on_idle);
  out.cwd = (typeof raw.cwd === 'string' && raw.cwd) ? raw.cwd : null;
  if (typeof raw.created_at === 'string') out.created_at = raw.created_at;
  out.project_id = (typeof raw.project_id === 'string' && raw.project_id) ? raw.project_id : DEFAULT_PROJECT_ID;
  if (typeof raw.project_name === 'string') out.project_name = raw.project_name;
  return out;
}

function migrateServers(serversIn) {
  let changed = false;
  const servers = {};
  for (const [srvId, list] of Object.entries(serversIn)) {
    if (!Array.isArray(list)) continue;
    servers[srvId] = list.map((s) => {
      if (s && typeof s === 'object' && !s.project_id) {
        changed = true;
        return { ...s, project_id: DEFAULT_PROJECT_ID };
      }
      return s;
    });
  }
  return { servers, changed };
}

async function readAndMigrate() {
  const data = await readStore(REL, EMPTY);
  if (!data || typeof data !== 'object') return EMPTY;
  const serversIn = data.servers && typeof data.servers === 'object' ? data.servers : {};
  const { servers, changed } = migrateServers(serversIn);
  const out = { servers, updated_at: data.updated_at ?? null };
  if (changed) {
    out.updated_at = new Date().toISOString();
    await withStoreLock(REL, async () => {
      const fresh = await readStore(REL, EMPTY);
      const freshServersIn = fresh?.servers && typeof fresh.servers === 'object' ? fresh.servers : {};
      const { servers: freshServers, changed: stillChanged } = migrateServers(freshServersIn);
      if (stillChanged) {
        await writeStore(REL, { servers: freshServers, updated_at: new Date().toISOString() });
      }
    });
  }
  return out;
}

function normalizePayload(raw) {
  if (!raw || typeof raw !== 'object') return { servers: {}, updated_at: new Date().toISOString() };
  const serversIn = raw.servers && typeof raw.servers === 'object' ? raw.servers : {};
  const servers = {};
  for (const [serverId, list] of Object.entries(serversIn)) {
    if (typeof serverId !== 'string' || !serverId) continue;
    if (!Array.isArray(list)) continue;
    servers[serverId] = list.map(normalizeSession).filter(Boolean);
  }
  return { servers, updated_at: new Date().toISOString() };
}

export const GET = withAuth(async () => {
  const data = await readAndMigrate();
  return NextResponse.json(data);
});

export const PUT = withAuth(async (req) => {
  const body = await req.json();
  const cleaned = normalizePayload(body);
  await withStoreLock(REL, async () => {
    await writeStore(REL, cleaned);
  });
  return NextResponse.json(cleaned);
});
