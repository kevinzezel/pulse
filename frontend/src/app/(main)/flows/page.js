'use client';

import '@excalidraw/excalidraw/index.css';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import toast from 'react-hot-toast';
import { Workflow, Loader2 } from 'lucide-react';
import {
  listFlows, createFlow, patchFlow, deleteFlow,
} from '@/services/api';
import { useTheme } from '@/providers/ThemeProvider';
import { useTranslation, useErrorToast } from '@/providers/I18nProvider';
import { useProjects } from '@/providers/ProjectsProvider';
import { useIsMobile } from '@/hooks/layout';
import { SAVE_DEBOUNCE_MS } from '@/lib/flowsConfig';
import FlowsSidebar from '@/components/Flows/FlowsSidebar';
import NewFlowModal from '@/components/Flows/NewFlowModal';

const Excalidraw = dynamic(
  () => import('@excalidraw/excalidraw').then((m) => ({ default: m.Excalidraw })),
  { ssr: false }
);

const SELECTED_FLOW_KEY = 'rt:selectedFlowId';
const SIDEBAR_OPEN_KEY = 'rt:flowsSidebarOpen';

function emptyScene() {
  return { elements: [], appState: {}, files: {} };
}

function loadFromStorage(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    if (v == null) return fallback;
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}

export default function FlowsPage() {
  const { t } = useTranslation();
  const { base, hydrated } = useTheme();
  const showError = useErrorToast();
  const isMobile = useIsMobile();
  const { activeProjectId } = useProjects();

  const [flows, setFlows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedFlowId, setSelectedFlowId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [creating, setCreating] = useState(false);
  const [savingIds, setSavingIds] = useState(new Set());
  const [toDelete, setToDelete] = useState(null);
  const [deletingFlowId, setDeletingFlowId] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [storageHydrated, setStorageHydrated] = useState(false);

  const pendingSceneRef = useRef({});
  const saveTimersRef = useRef({});
  const lastSceneRef = useRef({ id: null, elementsLen: 0, elementsVersion: 0, bgColor: null, filesCount: 0 });
  const userDeselectedRef = useRef(false);

  // Hydrate UI state from storage synchronously on mount.
  useEffect(() => {
    setSidebarOpen(loadFromStorage(SIDEBAR_OPEN_KEY, true));
    try {
      const storedFlow = localStorage.getItem(SELECTED_FLOW_KEY);
      if (storedFlow) setSelectedFlowId(storedFlow);
    } catch {}
    setStorageHydrated(true);
  }, []);

  // Persist UI state (after hydration, to avoid clobbering initial values).
  useEffect(() => {
    if (!storageHydrated) return;
    try { localStorage.setItem(SIDEBAR_OPEN_KEY, JSON.stringify(sidebarOpen)); } catch {}
  }, [sidebarOpen, storageHydrated]);

  useEffect(() => {
    if (!storageHydrated || loading) return;
    try {
      if (selectedFlowId) localStorage.setItem(SELECTED_FLOW_KEY, selectedFlowId);
      else localStorage.removeItem(SELECTED_FLOW_KEY);
    } catch {}
  }, [selectedFlowId, storageHydrated, loading]);

  // Fetch data after storage has been hydrated. Re-fetch on project switch.
  useEffect(() => {
    if (!storageHydrated) return;
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const flowsRes = await listFlows();
        if (!alive) return;
        const all = Array.isArray(flowsRes?.flows) ? flowsRes.flows : [];
        setFlows(all.filter((f) => f.project_id === activeProjectId));
      } catch (err) {
        showError(err);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
      // Flush any pending scene saves fire-and-forget. The backend file lock
      // keeps concurrent mutations serialized, so ordering is safe.
      for (const [id, timer] of Object.entries(saveTimersRef.current)) {
        clearTimeout(timer);
        const patch = pendingSceneRef.current[id];
        if (patch) {
          delete pendingSceneRef.current[id];
          patchFlow(id, patch).catch((err) =>
            console.warn('[flows] unmount flush failed', err)
          );
        }
      }
      saveTimersRef.current = {};
    };
  }, [storageHydrated, showError, activeProjectId]);

  const filteredFlows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return flows;
    return flows.filter((f) => f.name.toLowerCase().includes(q));
  }, [flows, searchQuery]);

  // Keep selection inside the visible list (only after full hydration).
  // Respects an explicit user deselect — stays empty.
  useEffect(() => {
    if (!storageHydrated || loading) return;
    if (selectedFlowId && flows.some((f) => f.id === selectedFlowId)) return;
    if (userDeselectedRef.current) return;
    if (flows.length > 0) {
      setSelectedFlowId(flows[0].id);
    } else {
      setSelectedFlowId(null);
    }
  }, [flows, selectedFlowId, storageHydrated, loading]);

  const selectedFlow = useMemo(
    () => flows.find((f) => f.id === selectedFlowId) || null,
    [flows, selectedFlowId]
  );

  const markSaving = useCallback((id, isSaving) => {
    setSavingIds((prev) => {
      const next = new Set(prev);
      if (isSaving) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const flushPendingScene = useCallback(async (id) => {
    const patch = pendingSceneRef.current[id];
    if (!patch) return;
    delete pendingSceneRef.current[id];
    markSaving(id, true);
    try {
      const updated = await patchFlow(id, patch);
      setFlows((prev) => prev.map((f) => (f.id === id ? updated : f)));
    } catch (err) {
      showError(err);
    } finally {
      markSaving(id, false);
    }
  }, [markSaving, showError]);

  const scheduleSceneSave = useCallback((id, scene) => {
    pendingSceneRef.current[id] = { scene };
    if (saveTimersRef.current[id]) clearTimeout(saveTimersRef.current[id]);
    saveTimersRef.current[id] = setTimeout(() => {
      delete saveTimersRef.current[id];
      flushPendingScene(id);
    }, SAVE_DEBOUNCE_MS);
  }, [flushPendingScene]);

  function handleExcalidrawChange(elements, appState, files) {
    if (!selectedFlowId) return;
    const prev = lastSceneRef.current;
    const elementsLen = elements.length;
    const versionSum = elements.reduce((acc, el) => acc + (el.version || 0), 0);
    const bgColor = appState?.viewBackgroundColor ?? null;
    const filesCount = files ? Object.keys(files).length : 0;
    if (
      prev.id === selectedFlowId &&
      prev.elementsLen === elementsLen &&
      prev.elementsVersion === versionSum &&
      prev.bgColor === bgColor &&
      prev.filesCount === filesCount
    ) {
      return;
    }
    lastSceneRef.current = { id: selectedFlowId, elementsLen, elementsVersion: versionSum, bgColor, filesCount };
    scheduleSceneSave(selectedFlowId, { elements, appState, files });
  }

  function handleSelect(id) {
    const isToggleOff = id === selectedFlowId;
    if (selectedFlowId && saveTimersRef.current[selectedFlowId]) {
      clearTimeout(saveTimersRef.current[selectedFlowId]);
      delete saveTimersRef.current[selectedFlowId];
      flushPendingScene(selectedFlowId);
    }
    lastSceneRef.current = { id: null, elementsLen: 0, elementsVersion: 0, bgColor: null, filesCount: 0 };
    if (isToggleOff) {
      userDeselectedRef.current = true;
      setSelectedFlowId(null);
    } else {
      userDeselectedRef.current = false;
      setSelectedFlowId(id);
    }
  }

  async function handleModalSubmit(name) {
    if (creating) return;
    setCreating(true);
    try {
      const created = await createFlow({ name, scene: emptyScene() });
      setFlows((prev) => [...prev, created]);
      setSelectedFlowId(created.id);
      lastSceneRef.current = { id: null, elementsLen: 0, elementsVersion: 0, bgColor: null, filesCount: 0 };
      setShowModal(false);
      toast.success(t('success.flow_created'));
    } catch (err) {
      showError(err);
    } finally {
      setCreating(false);
    }
  }

  async function handleRename(id, name) {
    markSaving(id, true);
    try {
      const updated = await patchFlow(id, { name });
      setFlows((prev) => prev.map((f) => (f.id === id ? updated : f)));
    } catch (err) {
      showError(err);
    } finally {
      markSaving(id, false);
    }
  }

  async function handleDuplicate(source) {
    markSaving(source.id, true);
    try {
      const name = `${source.name} ${t('flows.copySuffix')}`;
      const created = await createFlow({
        name,
        scene: source.scene || emptyScene(),
      });
      setFlows((prev) => [...prev, created]);
      setSelectedFlowId(created.id);
      lastSceneRef.current = { id: null, elementsLen: 0, elementsVersion: 0, bgColor: null, filesCount: 0 };
      toast.success(t('success.flow_duplicated'));
    } catch (err) {
      showError(err);
    } finally {
      markSaving(source.id, false);
    }
  }

  async function confirmDelete(flow) {
    if (deletingFlowId) return;
    setDeletingFlowId(flow.id);
    try {
      await deleteFlow(flow.id);
      setFlows((prev) => prev.filter((f) => f.id !== flow.id));
      toast.success(t('success.flow_deleted'));
      setToDelete(null);
    } catch (err) {
      showError(err);
    } finally {
      setDeletingFlowId(null);
    }
  }

  const excalidrawInitialData = useMemo(() => {
    if (!selectedFlow) return null;
    const scene = selectedFlow.scene || emptyScene();
    return {
      elements: Array.isArray(scene.elements) ? scene.elements : [],
      appState: {
        ...(scene.appState || {}),
        collaborators: new Map(),
      },
      files: scene.files || {},
    };
  }, [selectedFlow]);

  const defaultNewName = `Flow ${flows.length + 1}`;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className={`flex flex-1 min-h-0 overflow-hidden relative ${isMobile ? 'pl-12' : ''}`}>
        {isMobile && sidebarOpen && (
          <div
            className="sidebar-backdrop absolute inset-0 z-30"
            style={{ background: 'hsl(var(--overlay) / 0.6)' }}
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <FlowsSidebar
          flows={filteredFlows}
          selectedFlowId={selectedFlowId}
          savingIds={savingIds}
          creating={creating}
          isOpen={sidebarOpen}
          setIsOpen={setSidebarOpen}
          isMobile={isMobile}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          onSelect={handleSelect}
          onCreate={() => setShowModal(true)}
          onRename={handleRename}
          onDelete={(flow) => setToDelete(flow)}
          onDuplicate={handleDuplicate}
        />

        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          <div className="flex-1 min-h-0 relative" style={{ background: 'hsl(var(--background))' }}>
            {loading ? (
              <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
                {t('flows.loading')}
              </div>
            ) : !selectedFlow ? (
              <EmptyCanvas t={t} hasAny={flows.length > 0} />
            ) : hydrated ? (
              <Excalidraw
                key={selectedFlow.id}
                initialData={excalidrawInitialData}
                onChange={handleExcalidrawChange}
                theme={base}
                name={selectedFlow.name}
                UIOptions={{
                  canvasActions: {
                    loadScene: false,
                    saveToActiveFile: false,
                  },
                }}
              />
            ) : null}
          </div>
        </div>
      </div>

      {showModal && (
        <NewFlowModal
          onClose={() => setShowModal(false)}
          onSubmit={handleModalSubmit}
          loading={creating}
          fallbackName={defaultNewName}
        />
      )}

      {toDelete && (
        <DeleteConfirm
          t={t}
          flow={toDelete}
          loading={deletingFlowId === toDelete.id}
          onCancel={() => deletingFlowId ? null : setToDelete(null)}
          onConfirm={() => confirmDelete(toDelete)}
        />
      )}
    </div>
  );
}

function EmptyCanvas({ t, hasAny }) {
  return (
    <div className="flex flex-col h-full items-center justify-center gap-3 text-center p-8">
      <Workflow size={40} className="text-muted-foreground" />
      <p className="text-muted-foreground text-sm max-w-sm">
        {hasAny ? t('flows.emptyFilter') : t('flows.empty')}
      </p>
    </div>
  );
}

function DeleteConfirm({ t, flow, loading, onCancel, onConfirm }) {
  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: 'hsl(var(--overlay) / 0.6)' }}
      onClick={loading ? undefined : onCancel}
    >
      <div
        className="w-full max-w-sm rounded-lg border p-4 shadow-xl"
        style={{ background: 'hsl(var(--card))', color: 'hsl(var(--foreground))', borderColor: 'hsl(var(--border))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-2 text-sm font-semibold">{t('flows.deleteConfirmTitle')}</h3>
        <p className="mb-4 text-xs text-muted-foreground">
          {t('flows.deleteConfirmMessage', { name: flow.name })}
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={loading}
            className="rounded px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={onCancel}
          >
            {t('flows.cancel')}
          </button>
          <button
            type="button"
            disabled={loading}
            className="flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60 disabled:cursor-not-allowed"
            style={{ background: 'hsl(var(--destructive))' }}
            onClick={onConfirm}
          >
            {loading && <Loader2 size={12} className="animate-spin" />}
            {t('flows.deleteConfirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
