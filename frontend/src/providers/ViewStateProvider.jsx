'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { ssRead, ssWrite, ssRemove, ssListKeysWithPrefix } from '@/lib/sessionState';

const ViewStateContext = createContext(null);

const VIEW_PREFIX = 'rt:view::';

function groupKey(projectId) { return `${projectId}::group`; }
function flowKey(projectId) { return `${projectId}::flow`; }
function fullKey(inner) { return `${VIEW_PREFIX}${inner}`; }

export function ViewStateProvider({ children }) {
  const pathname = usePathname();
  const [viewState, setViewStateLocal] = useState({});
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (pathname === '/login') { setHydrated(false); return; }
    const keys = ssListKeysWithPrefix(VIEW_PREFIX);
    const next = {};
    for (const fk of keys) {
      const inner = fk.slice(VIEW_PREFIX.length);
      const value = ssRead(fk, null);
      if (typeof value === 'string' || value === null) {
        next[inner] = value;
      }
    }
    setViewStateLocal(next);
    setHydrated(true);
  }, [pathname]);

  const setKey = useCallback((key, value) => {
    setViewStateLocal(prev => {
      const cur = prev[key] ?? null;
      const nv = value ?? null;
      if (cur === nv) return prev;
      const next = { ...prev, [key]: nv };
      const fk = fullKey(key);
      if (nv === null) ssRemove(fk);
      else ssWrite(fk, nv);
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
