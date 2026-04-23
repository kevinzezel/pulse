'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { bootTabSession, tabKey, listTabKeysForScope } from '@/lib/tabSession';
import { readJSON, writeJSON, removeKey } from '@/lib/localState';

const ViewStateContext = createContext(null);

function groupKey(projectId) { return `${projectId}::group`; }
function flowKey(projectId) { return `${projectId}::flow`; }

export function ViewStateProvider({ children }) {
  const pathname = usePathname();
  const [viewState, setViewStateLocal] = useState({});
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (pathname === '/login') { setHydrated(false); return; }
    let alive = true;
    (async () => {
      try {
        await bootTabSession();
        if (!alive) return;
        const prefix = 'view::';
        const keys = listTabKeysForScope('view');
        const next = {};
        for (const fullKey of keys) {
          const idx = fullKey.indexOf(`::${prefix}`);
          if (idx === -1) continue;
          const inner = fullKey.slice(idx + prefix.length + 2);
          const value = readJSON(fullKey, null);
          if (typeof value === 'string' || value === null) {
            next[inner] = value;
          }
        }
        setViewStateLocal(next);
      } finally {
        if (alive) setHydrated(true);
      }
    })();
    return () => { alive = false; };
  }, [pathname]);

  const setKey = useCallback((key, value) => {
    setViewStateLocal(prev => {
      const cur = prev[key] ?? null;
      const nv = value ?? null;
      if (cur === nv) return prev;
      const next = { ...prev, [key]: nv };
      const fullKey = tabKey('view', key);
      if (fullKey) {
        if (nv === null) removeKey(fullKey);
        else writeJSON(fullKey, nv);
      }
      return next;
    });
  }, []);

  const setProjectGroup = useCallback((projectId, groupId) => {
    if (!projectId) return;
    setKey(groupKey(projectId), groupId || null);
  }, [setKey]);

  const setProjectFlow = useCallback((projectId, flowId) => {
    if (!projectId) return;
    setKey(flowKey(projectId), flowId || null);
  }, [setKey]);

  const getProjectGroup = useCallback((projectId) => {
    if (!projectId) return null;
    return viewState[groupKey(projectId)] ?? null;
  }, [viewState]);

  const getProjectFlow = useCallback((projectId) => {
    if (!projectId) return null;
    return viewState[flowKey(projectId)] ?? null;
  }, [viewState]);

  const value = {
    viewState,
    hydrated,
    setProjectGroup,
    setProjectFlow,
    getProjectGroup,
    getProjectFlow,
  };

  return <ViewStateContext.Provider value={value}>{children}</ViewStateContext.Provider>;
}

export function useViewState() {
  const ctx = useContext(ViewStateContext);
  if (!ctx) throw new Error('useViewState must be used within ViewStateProvider');
  return ctx;
}
