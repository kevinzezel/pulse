'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { destroyTerminalsByServerId } from '@/components/TerminalPane';
import { getLocalServers, setLocalServers } from '@/services/api';
import { useRefetchOnFocus } from '@/utils/useRefetchOnFocus';
import { isServerLocalToBrowser } from '@/utils/host';
import { timeoutSignal } from '@/utils/serverHealth';

const ServersContext = createContext(null);

// cacheState.localReachable é um Map<serverId, boolean> preenchido pelo probe
// async de `probeLocalReachable` abaixo. True quando a *mesma instância* do
// server está acessível via `http(s)://localhost:<port>/api/sessions` com a
// apiKey cadastrada (comprova mesma máquina + mesma instância).
const cacheState = { servers: [], localReachable: new Map() };

export function getServerById(id) {
  if (!id) return null;
  return cacheState.servers.find((s) => s.id === id) || null;
}

export function getAllServers() {
  return cacheState.servers;
}

// Combina a heurística pura (utils/host.js — ambos loopback) com o cache do
// probe assíncrono. Usar daqui nos botões de editor em vez de
// `isServerLocalToBrowser` direto: se o probe já rodou e comprovou que o
// localhost responde com a mesma apiKey, este função passa a retornar true
// mesmo quando o server.host é um IP LAN.
export function isServerLocal(server) {
  if (isServerLocalToBrowser(server)) return true;
  if (!server?.id) return false;
  return cacheState.localReachable.get(server.id) === true;
}

function connectionFieldsChanged(a, b) {
  return a.host !== b.host || a.port !== b.port || a.apiKey !== b.apiKey;
}

function invalidateAffectedTerminals(oldList, newList) {
  const newById = new Map(newList.map((s) => [s.id, s]));
  for (const old of oldList) {
    const next = newById.get(old.id);
    if (!next) {
      destroyTerminalsByServerId(old.id);
      continue;
    }
    if (connectionFieldsChanged(old, next)) {
      destroyTerminalsByServerId(old.id);
    }
  }
}

async function probeLocalReachable(server) {
  if (!server?.port || !server?.apiKey) return false;
  const scheme = server.protocol === 'https' ? 'https' : 'http';
  // /api/sessions exige apiKey. Se vier 200, é a *mesma instância* rodando na
  // mesma máquina do browser (loopback). Outra instância na mesma porta
  // retornaria 401 → descartamos como "não é o mesmo server".
  const url = `${scheme}://localhost:${server.port}/api/sessions`;
  const t = timeoutSignal(1500);
  try {
    const res = await fetch(url, {
      headers: { 'X-API-Key': server.apiKey },
      signal: t.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    t.cancel();
  }
}

export function ServersProvider({ children }) {
  const pathname = usePathname();
  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);
  // Mantido em paralelo ao cacheState.localReachable só pra disparar re-render
  // dos consumidores de useServers() quando um probe completa.
  const [localReachable, setLocalReachable] = useState(new Map());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getLocalServers();
      const list = Array.isArray(data?.servers) ? data.servers : [];
      setServers(list);
      cacheState.servers = list;
      setError(null);
      setLoaded(true);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  const save = useCallback(async (next) => {
    const data = await setLocalServers(next);
    const list = Array.isArray(data?.servers) ? data.servers : [];
    const prev = cacheState.servers;
    cacheState.servers = list;
    setServers(list);
    invalidateAffectedTerminals(prev, list);
    return list;
  }, []);

  useEffect(() => {
    if (pathname === '/login') {
      setLoading(false);
      return;
    }
    load();
  }, [load, pathname]);

  useRefetchOnFocus(
    () => { load().catch((err) => console.warn('[ServersProvider] focus refetch failed:', err)); },
    pathname !== '/login',
  );

  // Probe "same machine" pra cada server que não é loopback já. Corre em
  // paralelo, best-effort, reavaliado quando a lista de servers muda (invalida
  // entries que pertenciam a servers removidos/modificados) ou no focus (via
  // useRefetchOnFocus acima, indiretamente — load() muda `servers` → este
  // effect reroda). Falha do probe é silenciosa (connection refused / CORS /
  // timeout / apiKey errada) → entry fica false → botão abre no caminho remoto.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let cancelled = false;
    const aliveIds = new Set(servers.map((s) => s.id));
    for (const key of Array.from(cacheState.localReachable.keys())) {
      if (!aliveIds.has(key)) cacheState.localReachable.delete(key);
    }
    (async () => {
      for (const server of servers) {
        if (cancelled) return;
        if (isServerLocalToBrowser(server)) {
          cacheState.localReachable.set(server.id, true);
          continue;
        }
        const reachable = await probeLocalReachable(server);
        if (cancelled) return;
        const prev = cacheState.localReachable.get(server.id) === true;
        if (reachable !== prev) {
          if (reachable) cacheState.localReachable.set(server.id, true);
          else cacheState.localReachable.delete(server.id);
        }
      }
      if (!cancelled) {
        setLocalReachable(new Map(cacheState.localReachable));
      }
    })();
    return () => { cancelled = true; };
  }, [servers]);

  return (
    <ServersContext.Provider value={{ servers, loading, loaded, error, reload: load, save, localReachable }}>
      {children}
    </ServersContext.Provider>
  );
}

export function useServers() {
  const ctx = useContext(ServersContext);
  if (!ctx) throw new Error('useServers must be used within ServersProvider');
  return ctx;
}
