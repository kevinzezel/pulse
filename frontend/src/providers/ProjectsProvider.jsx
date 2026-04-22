'use client';

import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { usePathname } from 'next/navigation';
import {
  getProjects, setActiveProject as apiSetActive,
  createProject as apiCreate, renameProject as apiRename, deleteProject as apiDelete,
  reorderProjects as apiReorder,
  setActiveProjectIdInModule,
} from '@/services/api';
import { reorderById } from '@/utils/reorder';
import { DEFAULT_PROJECT_ID } from '@/lib/projectScope';

const STORAGE_KEY = 'rt:activeProjectId';

const ProjectsContext = createContext(null);

export function ProjectsProvider({ children }) {
  const pathname = usePathname();
  const [projects, setProjects] = useState([]);
  const [activeProjectId, setActiveProjectIdState] = useState(DEFAULT_PROJECT_ID);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        setActiveProjectIdState(stored);
        setActiveProjectIdInModule(stored);
      }
    } catch {}
  }, []);

  const applyState = useCallback((state) => {
    setProjects(state.projects || []);
    const next = state.active_project_id || DEFAULT_PROJECT_ID;
    setActiveProjectIdState(next);
    setActiveProjectIdInModule(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {}
  }, []);

  const refreshProjects = useCallback(async () => {
    setLoading(true);
    try {
      const state = await getProjects();
      applyState(state);
      setLoaded(true);
      return state;
    } finally {
      setLoading(false);
    }
  }, [applyState]);

  useEffect(() => {
    if (pathname === '/login') return;
    refreshProjects().catch(() => {});
  }, [pathname, refreshProjects]);

  const setActiveProject = useCallback(async (id) => {
    const res = await apiSetActive(id);
    applyState(res.state);
    return res;
  }, [applyState]);

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
    return res;
  }, [applyState]);

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
