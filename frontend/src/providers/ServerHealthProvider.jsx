'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useServers } from '@/providers/ServersProvider';
import { testServer } from '@/utils/serverHealth';

const ServerHealthContext = createContext(null);

// Status canonicos compartilhados entre provider, header chips e TerminalPane.
export const SERVER_HEALTH_STATUS = Object.freeze({
  UNKNOWN: 'unknown',
  CHECKING: 'checking',
  ONLINE: 'online',
  OFFLINE: 'offline',
});

// Backoff usado pra re-checar servers offline sem martelar a rede. O usuário
// fica em VPNs diferentes ao longo do dia, então um servidor pode ficar offline
// por minutos e voltar — preferimos manter intervalos maiores depois de tentar
// algumas vezes a fazer health checks contínuos. Jitter evita sincronia.
const BACKOFF_MS = [5000, 15000, 30000, 60000, 120000];

function initialEntry() {
  return {
    status: SERVER_HEALTH_STATUS.UNKNOWN,
    reason: null,
    lastSeenAt: null,
    lastCheckedAt: null,
  };
}

export function ServerHealthProvider({ children }) {
  const { servers } = useServers();
  const [health, setHealth] = useState({});
  // serverId -> { timer, attempt }
  const timersRef = useRef(new Map());
  // serverId -> in-flight check Promise (evita probes simultâneos no mesmo server)
  const inflightRef = useRef(new Map());
  const serversRef = useRef([]);

  useEffect(() => { serversRef.current = servers; }, [servers]);

  const setEntry = useCallback((serverId, partial) => {
    setHealth(prev => {
      const cur = prev[serverId] || initialEntry();
      const next = { ...cur, ...partial };
      if (
        next.status === cur.status &&
        next.reason === cur.reason &&
        next.lastSeenAt === cur.lastSeenAt &&
        next.lastCheckedAt === cur.lastCheckedAt
      ) {
        return prev;
      }
      return { ...prev, [serverId]: next };
    });
  }, []);

  const cancelBackoff = useCallback((serverId) => {
    const slot = timersRef.current.get(serverId);
    if (!slot) return;
    if (slot.timer) clearTimeout(slot.timer);
    timersRef.current.delete(serverId);
  }, []);

  const scheduleBackoffRef = useRef(null);
  const checkServerRef = useRef(null);

  const checkServer = useCallback(async (server, opts = {}) => {
    if (!server?.id) return null;
    const inflight = inflightRef.current.get(server.id);
    if (inflight) return inflight;
    const promise = (async () => {
      setEntry(server.id, { status: SERVER_HEALTH_STATUS.CHECKING });
      const result = await testServer(server);
      const now = new Date().toISOString();
      if (result.ok) {
        setEntry(server.id, {
          status: SERVER_HEALTH_STATUS.ONLINE,
          reason: null,
          lastSeenAt: now,
          lastCheckedAt: now,
        });
        cancelBackoff(server.id);
        timersRef.current.delete(server.id);
      } else {
        setEntry(server.id, {
          status: SERVER_HEALTH_STATUS.OFFLINE,
          reason: result.reason || 'unknown',
          lastCheckedAt: now,
        });
        if (opts.scheduleBackoff !== false) {
          scheduleBackoffRef.current?.(server);
        }
      }
      return result;
    })().finally(() => {
      inflightRef.current.delete(server.id);
    });
    inflightRef.current.set(server.id, promise);
    return promise;
  }, [setEntry, cancelBackoff]);
  checkServerRef.current = checkServer;

  const scheduleBackoff = useCallback((server) => {
    if (!server?.id) return;
    const prev = timersRef.current.get(server.id);
    if (prev?.timer) clearTimeout(prev.timer);
    const attempt = prev?.attempt ?? 0;
    const base = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
    const jitter = Math.random() * 0.25 * base;
    const timer = setTimeout(() => {
      timersRef.current.delete(server.id);
      const current = serversRef.current.find(s => s.id === server.id);
      if (!current) return;
      checkServerRef.current?.(current, { silent: true });
    }, base + jitter);
    timersRef.current.set(server.id, { timer, attempt: attempt + 1 });
  }, []);
  scheduleBackoffRef.current = scheduleBackoff;

  const markServerOnline = useCallback((serverId) => {
    if (!serverId) return;
    cancelBackoff(serverId);
    const now = new Date().toISOString();
    setEntry(serverId, {
      status: SERVER_HEALTH_STATUS.ONLINE,
      reason: null,
      lastSeenAt: now,
      lastCheckedAt: now,
    });
  }, [cancelBackoff, setEntry]);

  const markServerOffline = useCallback((serverId, reason = 'unknown') => {
    if (!serverId) return;
    setEntry(serverId, {
      status: SERVER_HEALTH_STATUS.OFFLINE,
      reason: reason || 'unknown',
      lastCheckedAt: new Date().toISOString(),
    });
    const server = serversRef.current.find(s => s.id === serverId);
    if (server) scheduleBackoffRef.current?.(server);
  }, [setEntry]);

  const retryServer = useCallback((serverId) => {
    const server = serversRef.current.find(s => s.id === serverId);
    if (!server) return Promise.resolve(null);
    cancelBackoff(serverId);
    // Reset attempt count para próxima sequência de backoff (caso o retry
    // manual falhe de novo, recomeça do passo 1).
    timersRef.current.set(serverId, { attempt: 0 });
    return checkServerRef.current?.(server, { silent: false });
  }, [cancelBackoff]);

  const getServerHealth = useCallback((serverId) => {
    if (!serverId) return initialEntry();
    return health[serverId] || initialEntry();
  }, [health]);

  // Drop entries + timers de servers que sumiram (deletados em Settings).
  useEffect(() => {
    const aliveIds = new Set(servers.map(s => s.id));
    setHealth(prev => {
      let changed = false;
      const next = {};
      for (const [k, v] of Object.entries(prev)) {
        if (aliveIds.has(k)) next[k] = v;
        else changed = true;
      }
      return changed ? next : prev;
    });
    for (const id of Array.from(timersRef.current.keys())) {
      if (!aliveIds.has(id)) {
        const slot = timersRef.current.get(id);
        if (slot?.timer) clearTimeout(slot.timer);
        timersRef.current.delete(id);
      }
    }
  }, [servers]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const slot of timers.values()) {
        if (slot.timer) clearTimeout(slot.timer);
      }
      timers.clear();
    };
  }, []);

  const value = useMemo(() => ({
    health,
    getServerHealth,
    markServerOnline,
    markServerOffline,
    checkServer,
    retryServer,
  }), [health, getServerHealth, markServerOnline, markServerOffline, checkServer, retryServer]);

  return (
    <ServerHealthContext.Provider value={value}>
      {children}
    </ServerHealthContext.Provider>
  );
}

export function useServerHealth() {
  const ctx = useContext(ServerHealthContext);
  if (!ctx) throw new Error('useServerHealth must be used within ServerHealthProvider');
  return ctx;
}
