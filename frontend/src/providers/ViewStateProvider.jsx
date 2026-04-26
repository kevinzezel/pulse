'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { ssRead, ssWrite, ssRemove, ssListKeysWithPrefix } from '@/lib/sessionState';

const ViewStateContext = createContext(null);

const VIEW_PREFIX = 'rt:view::';
const FLOW_EMPTY_VALUE = '__pulse_empty_flow__';
const PROMPT_EMPTY_VALUE = '__pulse_empty_prompt__';

function groupKey(projectId) { return `${projectId}::group`; }
function flowKey(projectId) { return `${projectId}::flow`; }
function flowGroupKey(projectId) { return `${projectId}::flowGroup`; }
function flowInGroupKey(projectId, groupId) {
  return `${projectId}::flow::${groupId ?? '__none__'}`;
}
function promptScopeKey(projectId) { return `${projectId}::promptScope`; }
function promptGroupKey(projectId) { return `${projectId}::promptGroup`; }
function promptInGroupKey(projectId, groupToken) {
  return `${projectId}::prompt::${groupToken ?? '__all__'}`;
}
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

  const setProjectFlowGroup = useCallback((projectId, groupId) => {
    if (!projectId) return;
    setKey(flowGroupKey(projectId), groupId || null);
  }, [setKey]);

  const setProjectFlowForGroup = useCallback((projectId, groupId, flowId) => {
    if (!projectId) return;
    setKey(flowInGroupKey(projectId, groupId), flowId || null);
  }, [setKey]);

  const setProjectFlowEmptyForGroup = useCallback((projectId, groupId) => {
    if (!projectId) return;
    setKey(flowInGroupKey(projectId, groupId), FLOW_EMPTY_VALUE);
  }, [setKey]);

  const getProjectGroup = useCallback((projectId) => {
    if (!projectId) return null;
    return viewState[groupKey(projectId)] ?? null;
  }, [viewState]);

  const getProjectFlow = useCallback((projectId) => {
    if (!projectId) return null;
    return viewState[flowKey(projectId)] ?? null;
  }, [viewState]);

  const getProjectFlowGroup = useCallback((projectId) => {
    if (!projectId) return null;
    return viewState[flowGroupKey(projectId)] ?? null;
  }, [viewState]);

  // Fallback chain: flow-per-group key first; if absent and the caller is
  // asking about "Sem grupo" (groupId=null), fall back to the legacy flat
  // flow key so existing users keep their last flow selected on first load.
  const getProjectFlowForGroup = useCallback((projectId, groupId) => {
    if (!projectId) return null;
    const scoped = viewState[flowInGroupKey(projectId, groupId)];
    if (scoped === FLOW_EMPTY_VALUE) return null;
    if (scoped !== undefined) return scoped ?? null;
    if (groupId === null) {
      return viewState[flowKey(projectId)] ?? null;
    }
    return null;
  }, [viewState]);

  const isProjectFlowEmptyForGroup = useCallback((projectId, groupId) => {
    if (!projectId) return false;
    return viewState[flowInGroupKey(projectId, groupId)] === FLOW_EMPTY_VALUE;
  }, [viewState]);

  const setProjectPromptScope = useCallback((projectId, scope) => {
    if (!projectId) return;
    setKey(promptScopeKey(projectId), scope || null);
  }, [setKey]);

  const getProjectPromptScope = useCallback((projectId) => {
    if (!projectId) return null;
    return viewState[promptScopeKey(projectId)] ?? null;
  }, [viewState]);

  const setProjectPromptGroup = useCallback((projectId, groupToken) => {
    if (!projectId) return;
    setKey(promptGroupKey(projectId), groupToken || null);
  }, [setKey]);

  const getProjectPromptGroup = useCallback((projectId) => {
    if (!projectId) return null;
    return viewState[promptGroupKey(projectId)] ?? null;
  }, [viewState]);

  const setProjectPromptForGroup = useCallback((projectId, groupToken, promptId) => {
    if (!projectId) return;
    setKey(promptInGroupKey(projectId, groupToken), promptId || null);
  }, [setKey]);

  const getProjectPromptForGroup = useCallback((projectId, groupToken) => {
    if (!projectId) return null;
    const scoped = viewState[promptInGroupKey(projectId, groupToken)];
    if (scoped === PROMPT_EMPTY_VALUE) return null;
    if (scoped !== undefined) return scoped ?? null;
    return null;
  }, [viewState]);

  const setProjectPromptEmptyForGroup = useCallback((projectId, groupToken) => {
    if (!projectId) return;
    setKey(promptInGroupKey(projectId, groupToken), PROMPT_EMPTY_VALUE);
  }, [setKey]);

  const isProjectPromptEmptyForGroup = useCallback((projectId, groupToken) => {
    if (!projectId) return false;
    return viewState[promptInGroupKey(projectId, groupToken)] === PROMPT_EMPTY_VALUE;
  }, [viewState]);

  const value = {
    viewState,
    hydrated,
    setProjectGroup,
    setProjectFlow,
    setProjectFlowGroup,
    setProjectFlowForGroup,
    setProjectFlowEmptyForGroup,
    getProjectGroup,
    getProjectFlow,
    getProjectFlowGroup,
    getProjectFlowForGroup,
    isProjectFlowEmptyForGroup,
    setProjectPromptScope,
    getProjectPromptScope,
    setProjectPromptGroup,
    getProjectPromptGroup,
    setProjectPromptForGroup,
    getProjectPromptForGroup,
    setProjectPromptEmptyForGroup,
    isProjectPromptEmptyForGroup,
  };

  return <ViewStateContext.Provider value={value}>{children}</ViewStateContext.Provider>;
}

export function useViewState() {
  const ctx = useContext(ViewStateContext);
  if (!ctx) throw new Error('useViewState must be used within ViewStateProvider');
  return ctx;
}
