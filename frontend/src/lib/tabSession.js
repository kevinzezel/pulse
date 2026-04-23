'use client';

const TAB_UUID_KEY = 'rt:tab-uuid';
const TAB_PROFILES_KEY = 'rt:tab-profiles';
const MIGRATION_FLAG_KEY = 'rt:migrated-from-server';
const CHANNEL_NAME = 'rt:tab-coord';
const TAB_LIMIT = 10;
const CLAIM_QUERY_TIMEOUT_MS = 150;

const INSTANCE_ID =
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;

let tabUuid = null;
let initPromise = null;
let channel = null;

function ssGet(key) { try { return sessionStorage.getItem(key); } catch { return null; } }
function ssSet(key, val) { try { sessionStorage.setItem(key, val); } catch {} }
function lsGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function lsSet(key, val) { try { localStorage.setItem(key, val); } catch {} }
function lsRemove(key) { try { localStorage.removeItem(key); } catch {} }

function readProfiles() {
  try {
    const raw = lsGet(TAB_PROFILES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p) => p && typeof p.uuid === 'string');
  } catch {
    return [];
  }
}

function writeProfiles(profiles) {
  lsSet(TAB_PROFILES_KEY, JSON.stringify(profiles));
}

export function removeAllForTab(uuid) {
  if (!uuid) return;
  const prefix = `rt:tab::${uuid}::`;
  try {
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) toRemove.push(k);
    }
    for (const k of toRemove) lsRemove(k);
  } catch {}
}

function pushProfileWithEvict(profiles, uuid) {
  profiles.push({ uuid, lastSeenTs: Date.now() });
  if (profiles.length > TAB_LIMIT) {
    profiles.sort((a, b) => (a.lastSeenTs || 0) - (b.lastSeenTs || 0));
    const evicted = profiles.shift();
    if (evicted) removeAllForTab(evicted.uuid);
  }
}

function generateUuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function ensureChannel() {
  if (channel || typeof BroadcastChannel === 'undefined') return channel;
  channel = new BroadcastChannel(CHANNEL_NAME);
  channel.addEventListener('message', (ev) => {
    const msg = ev.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.instanceId === INSTANCE_ID) return;
    if (msg.type === 'claim-query' && tabUuid) {
      channel.postMessage({ type: 'claim-response', uuid: tabUuid, instanceId: INSTANCE_ID });
    } else if (msg.type === 'claim-announce' && msg.uuid && msg.uuid === tabUuid) {
      // Outra aba reivindicou nosso UUID — colisão de race. Geramos novo.
      const fresh = generateUuid();
      tabUuid = fresh;
      ssSet(TAB_UUID_KEY, fresh);
      const profiles = readProfiles();
      if (!profiles.find((p) => p.uuid === fresh)) {
        pushProfileWithEvict(profiles, fresh);
        writeProfiles(profiles);
      }
      channel.postMessage({ type: 'claim-announce', uuid: fresh, instanceId: INSTANCE_ID });
    }
  });
  return channel;
}

async function discoverClaimedUuids() {
  const ch = ensureChannel();
  if (!ch) return new Set();
  const claimed = new Set();
  const handler = (ev) => {
    const msg = ev.data;
    if (msg && msg.type === 'claim-response' && typeof msg.uuid === 'string') {
      claimed.add(msg.uuid);
    }
  };
  ch.addEventListener('message', handler);
  ch.postMessage({ type: 'claim-query', instanceId: INSTANCE_ID });
  await new Promise((resolve) => setTimeout(resolve, CLAIM_QUERY_TIMEOUT_MS));
  ch.removeEventListener('message', handler);
  return claimed;
}

async function adoptOrCreateUuid() {
  const profiles = readProfiles();
  const claimed = await discoverClaimedUuids();
  for (const p of profiles) {
    if (!claimed.has(p.uuid)) {
      p.lastSeenTs = Date.now();
      writeProfiles(profiles);
      return p.uuid;
    }
  }
  const fresh = generateUuid();
  pushProfileWithEvict(profiles, fresh);
  writeProfiles(profiles);
  return fresh;
}

export async function initTabSession() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    if (typeof window === 'undefined') return null;
    let uuid = ssGet(TAB_UUID_KEY);
    if (!uuid) {
      uuid = await adoptOrCreateUuid();
      ssSet(TAB_UUID_KEY, uuid);
    } else {
      const profiles = readProfiles();
      const prof = profiles.find((p) => p.uuid === uuid);
      if (!prof) {
        pushProfileWithEvict(profiles, uuid);
        writeProfiles(profiles);
      } else {
        prof.lastSeenTs = Date.now();
        writeProfiles(profiles);
      }
    }
    tabUuid = uuid;
    const ch = ensureChannel();
    if (ch) ch.postMessage({ type: 'claim-announce', uuid, instanceId: INSTANCE_ID });
    return uuid;
  })();
  return initPromise;
}

export function getTabUuid() {
  return tabUuid;
}

export function tabKey(scope, ...parts) {
  if (!tabUuid) return null;
  return `rt:tab::${tabUuid}::${scope}::${parts.join('::')}`;
}

export function listTabKeysForScope(scope) {
  if (!tabUuid) return [];
  const prefix = `rt:tab::${tabUuid}::${scope}::`;
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) out.push(k);
    }
  } catch {}
  return out;
}

let migrationPromise = null;

// Migra estado do servidor pra localStorage uma única vez por instalação.
// Idempotente entre chamadas (cache via flag em localStorage + promise em memória).
export async function runMigrationOnce() {
  if (migrationPromise) return migrationPromise;
  migrationPromise = (async () => {
    if (typeof window === 'undefined') return;
    if (lsGet(MIGRATION_FLAG_KEY) === '1') return;
    if (!tabUuid) return; // claim precisa ter rodado antes
    try {
      const res = await fetch('/api/migrate-state', {
        method: 'GET',
        credentials: 'include',
      });
      if (!res.ok) return;
      const data = await res.json();
      const layouts = data && typeof data.layouts === 'object' && data.layouts !== null ? data.layouts : null;
      const viewState = data && typeof data.view_state === 'object' && data.view_state !== null ? data.view_state : null;
      if (layouts) {
        for (const [key, value] of Object.entries(layouts)) {
          const localKey = `rt:tab::${tabUuid}::layout::${key}`;
          try { localStorage.setItem(localKey, JSON.stringify(value)); } catch {}
        }
      }
      if (viewState) {
        for (const [key, value] of Object.entries(viewState)) {
          const localKey = `rt:tab::${tabUuid}::view::${key}`;
          try { localStorage.setItem(localKey, JSON.stringify(value)); } catch {}
        }
      }
    } catch {}
    lsSet(MIGRATION_FLAG_KEY, '1');
  })();
  return migrationPromise;
}

// Boot completo: claim do UUID + migração one-shot. Idempotente.
export async function bootTabSession() {
  await initTabSession();
  await runMigrationOnce();
  return tabUuid;
}
