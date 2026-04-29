'use client';

import { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { usePathname } from 'next/navigation';
import toast from 'react-hot-toast';
import {
  getProjects,
  createProject as apiCreate, renameProject as apiRename, deleteProject as apiDelete,
  setDefaultProject as apiSetDefault,
  setActiveProjectOnServer,
  setActiveProjectIdInModule,
  listBackends, getBackendManifest,
} from '@/services/api';
import { useRefetchOnFocus } from '@/utils/useRefetchOnFocus';
import { ssRead, ssWrite } from '@/lib/sessionState';
import { useTranslation } from '@/providers/I18nProvider';

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
  const { t } = useTranslation();
  const initialActiveProjectId = useMemo(() => readStoredActiveProjectId(), []);
  const [projects, setProjects] = useState([]);
  // Null until refreshProjects resolves with at least one project. The
  // OnboardingGate covers the empty-list case, so any non-null value here
  // is guaranteed to point at a real entry from a real backend.
  const [activeProjectId, setActiveProjectIdState] = useState(() => initialActiveProjectId);
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

  const refreshProjects = useCallback(async () => {
    setLoading(true);
    try {
      const state = await getProjects();
      const list = state.projects || [];
      setProjects(list);

      // Empty list -> OnboardingGate kicks in. Leave activeProjectId as-is
      // (likely null on a fresh install) so downstream code that depends on
      // it doesn't get stamped with a non-existent id.
      if (list.length > 0) {
        const storedId = hasTabActiveRef.current ? readStoredActiveProjectId() : null;
        const candidates = [storedId, state.active_project_id].filter(Boolean);
        const valid = candidates.find((id) => list.some((p) => p.id === id));
        const next = valid || list[0].id;
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

  // Periodic manifest refetch — every 5 min and on tab focus. Diffs each
  // remote backend's manifest against the local projects list and toasts when
  // there are project ids in the manifest that aren't local yet (a peer ran
  // Move/Create on a shared backend). Silent on transient errors so flaky
  // networks don't spam toasts.
  useEffect(() => {
    if (pathname === '/login') return;
    let cancelled = false;

    async function refreshManifests() {
      if (cancelled) return;
      try {
        const cfg = await listBackends();
        const remoteBackends = (cfg.backends || []).filter((b) => b.driver !== 'file');
        if (remoteBackends.length === 0) return;
        const knownIds = new Set(projects.map((p) => p.id));

        for (const backend of remoteBackends) {
          if (cancelled) return;
          try {
            const manifest = await getBackendManifest(backend.id);
            const newOnes = (manifest.projects || []).filter((p) => !knownIds.has(p.id));
            if (newOnes.length > 0 && !cancelled) {
              const names = newOnes.map((p) => p.name).slice(0, 3).join(', ');
              toast(t('settings.storage.newProjectsAvailable', {
                backend: backend.name,
                count: newOnes.length,
                names,
              }), { duration: 6000 });
            }
          } catch {
            // backend down or transient error — skip silently for this cycle
          }
        }
      } catch {
        // listBackends failure — skip silently
      }
    }

    const interval = setInterval(refreshManifests, 5 * 60 * 1000);
    function onVisible() {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        refreshManifests();
      }
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisible);
    }
    refreshManifests();

    return () => {
      cancelled = true;
      clearInterval(interval);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisible);
      }
    };
  }, [projects, t, pathname]);

  const setActiveProject = useCallback(async (id) => {
    persistActive(id);
    // Best-effort: persist in the per-install pref so a fresh tab without
    // sessionStorage picks the same active project. Failure is non-fatal --
    // the tab keeps working with its own sessionStorage choice.
    setActiveProjectOnServer(id).catch((err) => {
      console.warn('[ProjectsProvider] active pref sync failed:', err);
    });
  }, [persistActive]);

  // v4.2: createProject takes (name, targetBackendId). The server returns
  // the new project entry; we refresh from /api/projects so the manifest
  // aggregator runs and picks up the new entry alongside the rest.
  const createProject = useCallback(async (name, targetBackendId = 'local') => {
    const res = await apiCreate(name, targetBackendId);
    await refreshProjects();
    return res;
  }, [refreshProjects]);

  const renameProject = useCallback(async (id, name) => {
    const res = await apiRename(id, name);
    await refreshProjects();
    return res;
  }, [refreshProjects]);

  const deleteProject = useCallback(async (id) => {
    const res = await apiDelete(id);
    const state = await refreshProjects();
    if (id === activeProjectId) {
      // The DELETE route refuses to remove the only project, so the post-
      // delete list is guaranteed to have at least one survivor we can
      // pivot to.
      const next = (state?.projects || []).find((p) => p.id !== id);
      if (next) persistActive(next.id);
    }
    return res;
  }, [refreshProjects, activeProjectId, persistActive]);

  const setDefaultProject = useCallback(async (id) => {
    const res = await apiSetDefault(id);
    await refreshProjects();
    return res;
  }, [refreshProjects]);

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
    setDefaultProject,
  }), [projects, activeProjectId, activeProject, loading, loaded, refreshProjects, setActiveProject, createProject, renameProject, deleteProject, setDefaultProject]);

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
