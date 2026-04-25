'use client';

import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
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

const ProjectsContext = createContext(null);

export function ProjectsProvider({ children }) {
  const pathname = usePathname();
  const [projects, setProjects] = useState([]);
  const [activeProjectId, setActiveProjectIdState] = useState(DEFAULT_PROJECT_ID);
  const [hasTabActive, setHasTabActive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const stored = ssRead(STORAGE_KEY, null);
    if (typeof stored === 'string' && stored) {
      setActiveProjectIdState(stored);
      setActiveProjectIdInModule(stored);
      setHasTabActive(true);
    }
  }, []);

  const persistActive = useCallback((id) => {
    setActiveProjectIdState(id);
    setActiveProjectIdInModule(id);
    ssWrite(STORAGE_KEY, id);
    setHasTabActive(true);
  }, []);

  const applyState = useCallback((state, { adoptActive } = {}) => {
    setProjects(state.projects || []);
    if (adoptActive) {
      const next = state.active_project_id || DEFAULT_PROJECT_ID;
      persistActive(next);
    }
  }, [persistActive]);

  const refreshProjects = useCallback(async () => {
    setLoading(true);
    try {
      const state = await getProjects();
      applyState(state, { adoptActive: !hasTabActive });
      setLoaded(true);
      return state;
    } finally {
      setLoading(false);
    }
  }, [applyState, hasTabActive]);

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
    applyState(res.state, { adoptActive: false });
    return res;
  }, [applyState]);

  const renameProject = useCallback(async (id, name) => {
    const res = await apiRename(id, name);
    applyState(res.state, { adoptActive: false });
    return res;
  }, [applyState]);

  const deleteProject = useCallback(async (id) => {
    const res = await apiDelete(id);
    applyState(res.state, { adoptActive: false });
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
      applyState(res.state, { adoptActive: false });
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
