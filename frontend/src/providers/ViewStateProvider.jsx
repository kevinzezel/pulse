'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { getViewState, setViewState as apiSetViewState } from '@/services/api';

const SAVE_DEBOUNCE_MS = 400;

const LEGACY_GROUP_KEY = 'rt:selectedGroupId';
const LEGACY_FLOW_KEY = 'rt:selectedFlowId';

const ViewStateContext = createContext(null);

function groupKey(projectId) { return `${projectId}::group`; }
function flowKey(projectId) { return `${projectId}::flow`; }

export function ViewStateProvider({ children }) {
  const pathname = usePathname();
  const [viewState, setViewStateLocal] = useState({});
  const [hydrated, setHydrated] = useState(false);
  const saveTimer = useRef(null);
  const pendingRef = useRef(null);
  const inFlight = useRef(Promise.resolve());

  useEffect(() => {
    if (pathname === '/login') { setHydrated(false); return; }
    let alive = true;
    (async () => {
      try {
        const data = await getViewState().catch(() => ({ view_state: {} }));
        if (!alive) return;
        const remote = (data && typeof data.view_state === 'object' && !Array.isArray(data.view_state))
          ? { ...data.view_state }
          : {};
        setViewStateLocal(remote);
      } finally {
        if (alive) setHydrated(true);
      }
    })();
    return () => { alive = false; };
  }, [pathname]);

  useEffect(() => {
    if (!hydrated) return;
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.removeItem(LEGACY_GROUP_KEY);
      window.localStorage.removeItem(LEGACY_FLOW_KEY);
    } catch {}
  }, [hydrated]);

  const scheduleSave = useCallback((next) => {
    pendingRef.current = next;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const payload = pendingRef.current;
      if (!payload) return;
      inFlight.current = inFlight.current
        .catch(() => {})
        .then(() => apiSetViewState(payload))
        .catch(err => console.warn('[setViewState] failed', err));
    }, SAVE_DEBOUNCE_MS);
  }, []);

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  const setKey = useCallback((key, value) => {
    setViewStateLocal(prev => {
      const cur = prev[key] ?? null;
      const nv = value ?? null;
      if (cur === nv) return prev;
      const next = { ...prev, [key]: nv };
      scheduleSave(next);
      return next;
    });
  }, [scheduleSave]);

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
