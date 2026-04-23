'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { destroyTerminalsByServerId } from '@/components/TerminalPane';
import { getLocalServers, setLocalServers } from '@/services/api';
import { useRefetchOnFocus } from '@/utils/useRefetchOnFocus';

const ServersContext = createContext(null);

const cacheState = { servers: [] };

export function getServerById(id) {
  if (!id) return null;
  return cacheState.servers.find((s) => s.id === id) || null;
}

export function getAllServers() {
  return cacheState.servers;
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

export function ServersProvider({ children }) {
  const pathname = usePathname();
  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);

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

  return (
    <ServersContext.Provider value={{ servers, loading, loaded, error, reload: load, save }}>
      {children}
    </ServersContext.Provider>
  );
}

export function useServers() {
  const ctx = useContext(ServersContext);
  if (!ctx) throw new Error('useServers must be used within ServersProvider');
  return ctx;
}
