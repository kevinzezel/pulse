'use client';

import { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { usePathname } from 'next/navigation';
import {
  getProjects,
  createProject as apiCreate, renameProject as apiRename, deleteProject as apiDelete,
  reorderProjects as apiReorder,
  setActiveProjectIdInModule,
} from '@/services/api';
import { reorderById } from '@/utils/reorder';
import { useRefetchOnFocus } from '@/utils/useRefetchOnFocus';
import { DEFAULT_PROJECT_ID } from '@/lib/projectScope';
import { ssRead, ssWrite } from '@/lib/sessionState';

const STORAGE_KEY = 'rt:activeProjectId';

// ---------- Project lifecycle event bus ----------
//
// Module-level EventTarget keyed by event name. Used to coordinate cache
// invalidation when a project's storage_ref changes (Plan 3 — Move project
// between backends).
//
// Documented events:
//
//   project:storage-ref-changed
//     detail: { projectId, oldRef, newRef }
//     emitted after a successful Move operation. Subscribers (per-project
//     fetchers like NotesProvider, flows/page.js, tasks/page.js, prompts
//     components) should drop their cached state for `projectId` and refetch
//     from the new backend. Plan 2 wires the bus only — no emitters yet;
//     Plan 3's MoveProjectModal will fire the event after a successful move.
//
// Falls back to a no-op outside the browser (SSR / test env).
const projectEvents = typeof window !== 'undefined' && typeof EventTarget !== 'undefined'
  ? new EventTarget()
  : null;

export function emitProjectEvent(name, detail) {
  if (!projectEvents) return;
  projectEvents.dispatchEvent(new CustomEvent(name, { detail }));
}

// Returns an unsubscribe function. Pattern:
//   useEffect(() => {
//     return subscribeToProjectEvent('project:storage-ref-changed', (ev) => {
//       if (ev.detail.projectId === activeProjectId) refetch();
//     });
//   }, [activeProjectId, refetch]);
export function subscribeToProjectEvent(name, handler) {
  if (!projectEvents) return () => {};
  projectEvents.addEventListener(name, handler);
  return () => projectEvents.removeEventListener(name, handler);
}

const ProjectsContext = createContext(null);

function readStoredActiveProjectId() {
  const stored = ssRead(STORAGE_KEY, null);
  return (typeof stored === 'string' && stored) ? stored : null;
}

export function ProjectsProvider({ children }) {
  const pathname = usePathname();
  const initialActiveProjectId = useMemo(() => readStoredActiveProjectId(), []);
  const [projects, setProjects] = useState([]);
  const [activeProjectId, setActiveProjectIdState] = useState(() => initialActiveProjectId || DEFAULT_PROJECT_ID);
  // Ref instead of state: prevents refreshProjects from closing over a stale
  // value (the stale-closure capture was what overwrote the tab's chosen
  // project on F5).
  const hasTabActiveRef = useRef(Boolean(initialActiveProjectId));
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setActiveProjectIdInModule(activeProjectId);
  }, [activeProjectId]);

  const persistActive = useCallback((id) => {
    setActiveProjectIdState(id);
    setActiveProjectIdInModule(id);
    ssWrite(STORAGE_KEY, id);
    hasTabActiveRef.current = true;
  }, []);

  const applyState = useCallback((state) => {
    setProjects(state.projects || []);
  }, []);

  const refreshProjects = useCallback(async () => {
    setLoading(true);
    try {
      const state = await getProjects();
      const list = state.projects || [];
      setProjects(list);

      if (hasTabActiveRef.current) {
        // Tab already picked a project — keep it if still valid, else fall
        // back to the server's active id (if valid) and finally to the
        // default. Covers the case where another tab/process deleted it.
        const storedId = readStoredActiveProjectId() ?? DEFAULT_PROJECT_ID;
        if (!list.some(p => p.id === storedId)) {
          const serverActive = state.active_project_id;
          const fallback = list.some(p => p.id === serverActive)
            ? serverActive
            : DEFAULT_PROJECT_ID;
          persistActive(fallback);
        }
      } else {
        const serverActive = state.active_project_id;
        const next = list.some(p => p.id === serverActive)
          ? serverActive
          : DEFAULT_PROJECT_ID;
        persistActive(next);
      }
      setLoaded(true);
      return state;
    } finally {
      setLoading(false);
    }
  }, [persistActive]);

  useEffect(() => {
    if (pathname === '/login') return;
    refreshProjects().catch(() => {});
  }, [pathname, refreshProjects]);

  useRefetchOnFocus(
    () => { refreshProjects().catch((err) => console.warn('[ProjectsProvider] focus refetch failed:', err)); },
    loaded && pathname !== '/login',
  );

  const setActiveProject = useCallback(async (id) => {
    persistActive(id);
  }, [persistActive]);

  const createProject = useCallback(async (name) => {
    const res = await apiCreate(name);
    applyState(res.state);
    return res;
  }, [applyState]);

  const renameProject = useCallback(async (id, name) => {
    const res = await apiRename(id, name);
    applyState(res.state);
    return res;
  }, [applyState]);

  const deleteProject = useCallback(async (id) => {
    const res = await apiDelete(id);
    applyState(res.state);
    if (id === activeProjectId) {
      const next = (res.state?.projects || []).find((p) => p.id !== id);
      persistActive(next ? next.id : DEFAULT_PROJECT_ID);
    }
    return res;
  }, [applyState, activeProjectId, persistActive]);

  const reorderProject = useCallback(async (fromId, toId) => {
    if (fromId === toId) return;
    setProjects(prev => reorderById(prev, fromId, toId));
    try {
      const res = await apiReorder(fromId, toId);
      applyState(res.state);
    } catch (err) {
      await refreshProjects().catch(() => {});
      throw err;
    }
  }, [applyState, refreshProjects]);

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) || null,
    [projects, activeProjectId]
  );

  const value = useMemo(() => ({
    projects,
    activeProjectId,
    activeProject,
    loading,
    loaded,
    refreshProjects,
    setActiveProject,
    createProject,
    renameProject,
    deleteProject,
    reorderProject,
  }), [projects, activeProjectId, activeProject, loading, loaded, refreshProjects, setActiveProject, createProject, renameProject, deleteProject, reorderProject]);

  return (
    <ProjectsContext.Provider value={value}>
      {children}
    </ProjectsContext.Provider>
  );
}

export function useProjects() {
  const ctx = useContext(ProjectsContext);
  if (!ctx) throw new Error('useProjects must be used within ProjectsProvider');
  return ctx;
}
