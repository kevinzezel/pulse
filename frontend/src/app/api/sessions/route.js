import { NextResponse } from 'next/server';
import { readLocalStore, writeLocalStore, withLocalStoreLock } from '@/lib/projectStorage';
import { withAuth } from '@/lib/auth';

const REL = 'data/sessions.json';
const EMPTY = { servers: {}, updated_at: null };

// Sessions written before v4.2 may carry the old `proj-default` stub id;
// the OnboardingGate guarantees new sessions are always created with a real
// project_id. We pass legacy values through unchanged -- they survive as
// orphans that get culled the next time the user kills/restores the
// session, which is good enough.
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
  if (typeof raw.project_id === 'string' && raw.project_id) out.project_id = raw.project_id;
  if (typeof raw.project_name === 'string') out.project_name = raw.project_name;
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
  const data = await readLocalStore(REL, EMPTY);
  return NextResponse.json(data && typeof data === 'object' ? data : EMPTY);
});

export const PUT = withAuth(async (req) => {
  const body = await req.json();
  const cleaned = normalizePayload(body);
  await withLocalStoreLock(REL, async () => {
    await writeLocalStore(REL, cleaned);
  });
  return NextResponse.json(cleaned);
});
