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
  AWAITING_MANUAL_RETRY: 'awaiting_manual_retry',
});

// Backoff usado pra re-checar servers offline sem martelar a rede. O usuário
// fica em VPNs diferentes ao longo do dia, então um servidor pode ficar offline
// por minutos e voltar — preferimos manter intervalos maiores depois de tentar
// algumas vezes a fazer health checks contínuos. Jitter evita sincronia.
export const SERVER_HEALTH_MAX_AUTO_ATTEMPTS = 3;
const BACKOFF_MS = [5000, 15000, 30000];

function initialEntry() {
  return {
    status: SERVER_HEALTH_STATUS.UNKNOWN,
    reason: null,
    lastSeenAt: null,
    lastCheckedAt: null,
    nextRetryAt: null,
    attempt: 0,
    maxAutoAttempts: SERVER_HEALTH_MAX_AUTO_ATTEMPTS,
    // null = unknown (never checked, or pre-4.6 client without the field).
    // true/false = canonical answer from the client's /health response.
    sameServer: null,
  };
}

function connectionKey(server) {
  if (!server?.id) return '';
  return [
    server.protocol === 'https' ? 'https' : 'http',
    server.host || '',
    server.port || '',
    server.apiKey || '',
  ].join('::');
}

export function ServerHealthProvider({ children }) {
  const { servers } = useServers();
  const [health, setHealth] = useState({});
  // serverId -> { timer, attempt }
  const timersRef = useRef(new Map());
  // serverId -> { key, promise } (evita probes simultâneos da mesma config)
  const inflightRef = useRef(new Map());
  // serverId -> connectionKey last scheduled for the canonical /health probe.
  const probedConnectionRef = useRef(new Map());
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
        next.lastCheckedAt === cur.lastCheckedAt &&
        next.nextRetryAt === cur.nextRetryAt &&
        next.attempt === cur.attempt &&
        next.maxAutoAttempts === cur.maxAutoAttempts &&
        next.sameServer === cur.sameServer
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
    const key = connectionKey(server);
    const inflight = inflightRef.current.get(server.id);
    if (inflight?.key === key) return inflight.promise;
    const promise = (async () => {
      const slot = timersRef.current.get(server.id);
      setEntry(server.id, {
        status: SERVER_HEALTH_STATUS.CHECKING,
        nextRetryAt: null,
        attempt: slot?.attempt || 0,
        maxAutoAttempts: SERVER_HEALTH_MAX_AUTO_ATTEMPTS,
      });
      const result = await testServer(server);
      const current = serversRef.current.find(s => s.id === server.id);
      if (!current || connectionKey(current) !== key) {
        return result;
      }
      const now = new Date().toISOString();
      if (result.ok) {
        setEntry(server.id, {
          status: SERVER_HEALTH_STATUS.ONLINE,
          reason: null,
          lastSeenAt: now,
          lastCheckedAt: now,
          nextRetryAt: null,
          attempt: 0,
          maxAutoAttempts: SERVER_HEALTH_MAX_AUTO_ATTEMPTS,
          sameServer: typeof result.sameServer === 'boolean' ? result.sameServer : null,
        });
        cancelBackoff(server.id);
      } else {
        setEntry(server.id, {
          status: SERVER_HEALTH_STATUS.OFFLINE,
          reason: result.reason || 'unknown',
          lastCheckedAt: now,
          nextRetryAt: null,
          attempt: slot?.attempt || 0,
          maxAutoAttempts: SERVER_HEALTH_MAX_AUTO_ATTEMPTS,
        });
        if (opts.scheduleBackoff !== false) {
          scheduleBackoffRef.current?.(server, result.reason || 'unknown');
        }
      }
      return result;
    })().finally(() => {
      const current = inflightRef.current.get(server.id);
      if (current?.key === key) inflightRef.current.delete(server.id);
    });
    inflightRef.current.set(server.id, { key, promise });
    return promise;
  }, [setEntry, cancelBackoff]);
  checkServerRef.current = checkServer;

  const scheduleBackoff = useCallback((server, reason = 'unknown') => {
    if (!server?.id) return;
    const prev = timersRef.current.get(server.id);
    if (prev?.timer) clearTimeout(prev.timer);
    const attempt = prev?.attempt ?? 0;
    if (attempt >= SERVER_HEALTH_MAX_AUTO_ATTEMPTS) {
      timersRef.current.set(server.id, { timer: null, attempt, reason });
      setEntry(server.id, {
        status: SERVER_HEALTH_STATUS.AWAITING_MANUAL_RETRY,
        reason: reason || 'unknown',
        nextRetryAt: null,
        attempt,
        maxAutoAttempts: SERVER_HEALTH_MAX_AUTO_ATTEMPTS,
        lastCheckedAt: new Date().toISOString(),
      });
      return;
    }
    const base = BACKOFF_MS[attempt];
    const jitter = Math.random() * 0.25 * base;
    const nextAttempt = attempt + 1;
    const nextRetryAt = new Date(Date.now() + base + jitter).toISOString();
    const timer = setTimeout(() => {
      const slot = timersRef.current.get(server.id);
      if (slot) {
        timersRef.current.set(server.id, { ...slot, timer: null, nextRetryAt: null });
      }
      const current = serversRef.current.find(s => s.id === server.id);
      if (!current) return;
      checkServerRef.current?.(current, { silent: true });
    }, base + jitter);
    timersRef.current.set(server.id, { timer, attempt: nextAttempt, reason, nextRetryAt });
    setEntry(server.id, {
      status: SERVER_HEALTH_STATUS.OFFLINE,
      reason: reason || 'unknown',
      nextRetryAt,
      attempt: nextAttempt,
      maxAutoAttempts: SERVER_HEALTH_MAX_AUTO_ATTEMPTS,
    });
  }, [setEntry]);
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
      nextRetryAt: null,
      attempt: 0,
      maxAutoAttempts: SERVER_HEALTH_MAX_AUTO_ATTEMPTS,
    });
  }, [cancelBackoff, setEntry]);

  const markServerOffline = useCallback((serverId, reason = 'unknown') => {
    if (!serverId) return;
    const slot = timersRef.current.get(serverId);
    if (slot?.attempt >= SERVER_HEALTH_MAX_AUTO_ATTEMPTS) {
      if (slot.timer) {
        clearTimeout(slot.timer);
        timersRef.current.set(serverId, { ...slot, timer: null, nextRetryAt: null });
      }
      setEntry(serverId, {
        status: SERVER_HEALTH_STATUS.AWAITING_MANUAL_RETRY,
        reason: reason || 'unknown',
        nextRetryAt: null,
        attempt: slot.attempt,
        maxAutoAttempts: SERVER_HEALTH_MAX_AUTO_ATTEMPTS,
        lastCheckedAt: new Date().toISOString(),
      });
      return;
    }
    setEntry(serverId, {
      status: SERVER_HEALTH_STATUS.OFFLINE,
      reason: reason || 'unknown',
      lastCheckedAt: new Date().toISOString(),
      nextRetryAt: null,
      attempt: slot?.attempt || 0,
      maxAutoAttempts: SERVER_HEALTH_MAX_AUTO_ATTEMPTS,
    });
    const server = serversRef.current.find(s => s.id === serverId);
    if (server) scheduleBackoffRef.current?.(server, reason || 'unknown');
  }, [setEntry]);

  const retryServer = useCallback((serverId) => {
    const server = serversRef.current.find(s => s.id === serverId);
    if (!server) return Promise.resolve(null);
    cancelBackoff(serverId);
    // Reset attempt count para próxima sequência de backoff (caso o retry
    // manual falhe de novo, recomeça do passo 1).
    timersRef.current.set(serverId, { timer: null, attempt: 0, reason: null, nextRetryAt: null });
    setEntry(serverId, {
      status: SERVER_HEALTH_STATUS.CHECKING,
      reason: null,
      nextRetryAt: null,
      attempt: 0,
      maxAutoAttempts: SERVER_HEALTH_MAX_AUTO_ATTEMPTS,
    });
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
    for (const id of Array.from(probedConnectionRef.current.keys())) {
      if (!aliveIds.has(id)) probedConnectionRef.current.delete(id);
    }
  }, [servers]);

  // Popula a resposta canônica `sameServer` a partir de /health no fluxo
  // normal de carregamento. O dashboard principal também chama /api/sessions
  // e marca o server como online, mas esse endpoint não carrega same_server;
  // sem esta checagem, servers cadastrados por IP LAN continuariam caindo no
  // fallback antigo até o usuário apertar retry/test manual.
  useEffect(() => {
    for (const server of servers) {
      if (!server?.id) continue;
      const key = connectionKey(server);
      const prev = probedConnectionRef.current.get(server.id);
      if (prev === key) continue;
      probedConnectionRef.current.set(server.id, key);
      if (prev !== undefined) {
        cancelBackoff(server.id);
        setEntry(server.id, {
          status: SERVER_HEALTH_STATUS.UNKNOWN,
          reason: null,
          lastSeenAt: null,
          lastCheckedAt: null,
          nextRetryAt: null,
          attempt: 0,
          maxAutoAttempts: SERVER_HEALTH_MAX_AUTO_ATTEMPTS,
          sameServer: null,
        });
      }
      checkServerRef.current?.(server, { scheduleBackoff: false });
    }
  }, [servers, cancelBackoff, setEntry]);

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
