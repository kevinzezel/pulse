'use client';

import '@excalidraw/excalidraw/index.css';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import toast from 'react-hot-toast';
import { Workflow, Loader2 } from 'lucide-react';
import {
  listFlows, createFlow, patchFlow, deleteFlow,
  getFlowGroups, reorderFlowGroups,
  createFlowGroup, renameFlowGroup, deleteFlowGroup, setFlowGroupHidden,
} from '@/services/api';
import { useTheme } from '@/providers/ThemeProvider';
import { useTranslation, useErrorToast } from '@/providers/I18nProvider';
import { useProjects } from '@/providers/ProjectsProvider';
import { useViewState } from '@/providers/ViewStateProvider';
import { useIsMobile } from '@/hooks/layout';
import { SAVE_DEBOUNCE_MS } from '@/lib/flowsConfig';
import FlowsSidebar from '@/components/Flows/FlowsSidebar';
import NewFlowModal from '@/components/Flows/NewFlowModal';
import GroupSelector from '@/components/GroupSelector';

const FLOW_GROUP_SUCCESS_KEYS = Object.freeze({
  created: 'success.flow_group_created',
  renamed: 'success.flow_group_renamed',
  deleted: 'success.flow_group_deleted',
  shown: 'success.flow_group_shown',
});

const Excalidraw = dynamic(
  () => import('@excalidraw/excalidraw').then((m) => ({ default: m.Excalidraw })),
  { ssr: false }
);

const SIDEBAR_OPEN_KEY = 'rt:flowsSidebarOpen';
const EMPTY_ARRAY = Object.freeze([]);

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
  const {
    setProjectFlow,
    setProjectFlowGroup,
    setProjectFlowForGroup,
    setProjectFlowEmptyForGroup,
    getProjectFlowGroup,
    getProjectFlowForGroup,
    isProjectFlowEmptyForGroup,
    hydrated: hydratedViewState,
  } = useViewState();

  const [flows, setFlows] = useState([]);
  const [flowGroups, setFlowGroups] = useState([]);
  const [flowsProjectId, setFlowsProjectId] = useState(null);
  const [flowGroupsProjectId, setFlowGroupsProjectId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [creating, setCreating] = useState(false);
  const [savingIds, setSavingIds] = useState(new Set());
  const [toDelete, setToDelete] = useState(null);
  const [deletingFlowId, setDeletingFlowId] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [sidebarHydrated, setSidebarHydrated] = useState(false);
  const storageHydrated = sidebarHydrated && hydratedViewState;
  const dataReady = storageHydrated
    && flowsProjectId === activeProjectId
    && flowGroupsProjectId === activeProjectId;

  // Render-time gate: when projectId in state doesn't match the active one,
  // the underlying state still holds the previous project's data because
  // setState calls scheduled inside useEffect don't apply until the next
  // render cycle. Returning the empty list here closes the one-frame leak
  // that survived v4.2.2-pre's effect-time clear (mirrors the
  // `groupsForDisplay` pattern in app/(main)/page.js).
  const flowsCur = useMemo(() => {
    if (flowsProjectId !== activeProjectId) return EMPTY_ARRAY;
    return flows.filter((f) => f && f.project_id === activeProjectId);
  }, [flows, flowsProjectId, activeProjectId]);
  const flowGroupsCur = useMemo(() => {
    if (flowGroupsProjectId !== activeProjectId) return EMPTY_ARRAY;
    return flowGroups.filter((g) => g && g.project_id === activeProjectId);
  }, [flowGroups, flowGroupsProjectId, activeProjectId]);

  const allFlowGroupIds = useMemo(
    () => new Set(flowGroupsCur.map((g) => g.id)),
    [flowGroupsCur],
  );

  const visibleFlowGroupIds = useMemo(
    () => new Set(flowGroupsCur.filter((g) => !g.hidden).map((g) => g.id)),
    [flowGroupsCur],
  );

  const rawSelectedFlowGroupId = hydratedViewState ? getProjectFlowGroup(activeProjectId) : null;
  const selectedFlowGroupId = (rawSelectedFlowGroupId && visibleFlowGroupIds.has(rawSelectedFlowGroupId))
    ? rawSelectedFlowGroupId
    : null;

  const setSelectedFlowGroupId = useCallback((id) => {
    if (!activeProjectId) return;
    setProjectFlowGroup(activeProjectId, id);
  }, [activeProjectId, setProjectFlowGroup]);

  const selectedFlowId = hydratedViewState
    ? getProjectFlowForGroup(activeProjectId, selectedFlowGroupId)
    : null;
  const selectedFlowEmpty = hydratedViewState
    ? isProjectFlowEmptyForGroup(activeProjectId, selectedFlowGroupId)
    : false;

  const setSelectedFlowId = useCallback((id) => {
    if (!activeProjectId) return;
    setProjectFlowForGroup(activeProjectId, selectedFlowGroupId, id);
    // Keep the legacy flat key in sync with the user's most recent pick so a
    // future downgrade or migration that reads only `rt:view::<p>::flow` still
    // sees a sensible value.
    setProjectFlow(activeProjectId, id);
  }, [activeProjectId, selectedFlowGroupId, setProjectFlowForGroup, setProjectFlow]);

  const pendingSceneRef = useRef({});
  const saveTimersRef = useRef({});
  const activeProjectIdRef = useRef(activeProjectId);
  const lastSceneRef = useRef({ id: null, elementsLen: 0, elementsVersion: 0, bgColor: null, filesCount: 0 });

  useEffect(() => {
    activeProjectIdRef.current = activeProjectId;
  }, [activeProjectId]);

  useEffect(() => {
    const storedSidebar = (() => {
      try { return localStorage.getItem(SIDEBAR_OPEN_KEY); } catch { return null; }
    })();
    if (storedSidebar != null) {
      try { setSidebarOpen(JSON.parse(storedSidebar)); } catch { setSidebarOpen(!isMobile); }
    } else {
      setSidebarOpen(!isMobile);
    }
    setSidebarHydrated(true);
  }, [isMobile]);

  useEffect(() => {
    if (!sidebarHydrated) return;
    try { localStorage.setItem(SIDEBAR_OPEN_KEY, JSON.stringify(sidebarOpen)); } catch {}
  }, [sidebarOpen, sidebarHydrated]);

  const fetchFlowGroups = useCallback(async () => {
    if (!activeProjectId) return;
    try {
      const list = await getFlowGroups(activeProjectId);
      setFlowGroups(Array.isArray(list) ? list : []);
    } catch (err) {
      showError(err);
    } finally {
      setFlowGroupsProjectId(activeProjectId);
    }
  }, [activeProjectId, showError]);

  // Fetch data after storage has been hydrated. Re-fetch on project switch.
  useEffect(() => {
    if (!storageHydrated) return;
    if (!activeProjectId) return;
    let alive = true;
    const projectId = activeProjectId;
    // Clear stale state synchronously so any modal/dropdown opened mid-fetch
    // doesn't expose flow-groups from the previous project.
    setFlows([]);
    setFlowGroups([]);
    setFlowsProjectId(null);
    setFlowGroupsProjectId(null);
    setLoading(true);
    (async () => {
      try {
        const [flowsList, groupsList] = await Promise.all([
          listFlows(projectId),
          getFlowGroups(projectId),
        ]);
        if (!alive) return;
        setFlows(Array.isArray(flowsList) ? flowsList : []);
        setFlowsProjectId(projectId);
        setFlowGroups(Array.isArray(groupsList) ? groupsList : []);
        setFlowGroupsProjectId(projectId);
      } catch (err) {
        showError(err);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
      // Flush any pending scene saves fire-and-forget. The backend file lock
      // keeps concurrent mutations serialized, so ordering is safe. Use the
      // project id captured at effect start — if the user switched projects
      // the pending patch belongs to the previous project.
      for (const [id, timer] of Object.entries(saveTimersRef.current)) {
        clearTimeout(timer);
        const pending = pendingSceneRef.current[id];
        const patch = pending?.patch;
        if (patch) {
          delete pendingSceneRef.current[id];
          patchFlow(pending.projectId || projectId, id, patch).catch((err) =>
            console.warn('[flows] unmount flush failed', err)
          );
        }
      }
      saveTimersRef.current = {};
    };
  }, [storageHydrated, showError, activeProjectId]);

  // Effective group_id of a flow: ignore stale ids that don't match any
  // current group. Treat them as ungrouped so the UI never shows a flow under
  // a group that's been deleted (or that came from a previous schema where
  // group_id pointed at a terminal group).
  const effectiveGroupOf = useCallback((flow) => {
    if (!flow) return null;
    const gid = flow.group_id;
    if (gid && allFlowGroupIds.has(gid)) return gid;
    return null;
  }, [allFlowGroupIds]);

  useEffect(() => {
    if (!dataReady) return;
    if (!rawSelectedFlowGroupId) return;
    if (visibleFlowGroupIds.has(rawSelectedFlowGroupId)) return;
    setSelectedFlowGroupId(null);
  }, [dataReady, rawSelectedFlowGroupId, visibleFlowGroupIds, setSelectedFlowGroupId]);

  const flowsInSelectedGroup = useMemo(
    () => flowsCur.filter((f) => effectiveGroupOf(f) === selectedFlowGroupId),
    [flowsCur, selectedFlowGroupId, effectiveGroupOf],
  );

  const groupSelectorItems = useMemo(
    () => flowsCur.filter((f) => {
      const gid = effectiveGroupOf(f);
      return gid === null || visibleFlowGroupIds.has(gid);
    }),
    [flowsCur, effectiveGroupOf, visibleFlowGroupIds],
  );

  const filteredFlows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return flowsInSelectedGroup;
    return flowsInSelectedGroup.filter((f) => f.name.toLowerCase().includes(q));
  }, [flowsInSelectedGroup, searchQuery]);

  // Keep selection inside the current group's list (only after full hydration).
  // Respects an explicit persisted deselect — stays empty until they pick
  // another flow in this project/group.
  useEffect(() => {
    if (!dataReady || loading) return;
    if (selectedFlowId && flowsInSelectedGroup.some((f) => f.id === selectedFlowId)) return;
    if (selectedFlowEmpty) return;
    if (flowsInSelectedGroup.length > 0) {
      setSelectedFlowId(flowsInSelectedGroup[0].id);
    } else {
      setSelectedFlowId(null);
    }
  }, [flowsInSelectedGroup, selectedFlowId, selectedFlowEmpty, dataReady, loading, setSelectedFlowId]);

  const selectedFlow = useMemo(
    () => flowsInSelectedGroup.find((f) => f.id === selectedFlowId) || null,
    [flowsInSelectedGroup, selectedFlowId]
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
    const pending = pendingSceneRef.current[id];
    if (!pending) return;
    const projectId = pending.projectId;
    const patch = pending.patch;
    if (!projectId || !patch) return;
    delete pendingSceneRef.current[id];
    markSaving(id, true);
    try {
      const updated = await patchFlow(projectId, id, patch);
      if (activeProjectIdRef.current === projectId) {
        setFlows((prev) => prev.map((f) => (f.id === id ? updated : f)));
      }
    } catch (err) {
      if (activeProjectIdRef.current === projectId) {
        showError(err);
      } else {
        console.warn('[flows] stale autosave failed after project switch', err);
      }
    } finally {
      markSaving(id, false);
    }
  }, [markSaving, showError]);

  const scheduleSceneSave = useCallback((id, projectId, scene) => {
    if (!projectId) return;
    pendingSceneRef.current[id] = { projectId, patch: { scene } };
    if (saveTimersRef.current[id]) clearTimeout(saveTimersRef.current[id]);
    saveTimersRef.current[id] = setTimeout(() => {
      delete saveTimersRef.current[id];
      flushPendingScene(id);
    }, SAVE_DEBOUNCE_MS);
  }, [flushPendingScene]);

  function handleExcalidrawChange(elements, appState, files) {
    if (!selectedFlowId || !selectedFlow?.project_id) return;
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
    scheduleSceneSave(selectedFlowId, selectedFlow.project_id, { elements, appState, files });
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
      setProjectFlowEmptyForGroup(activeProjectId, selectedFlowGroupId);
      setProjectFlow(activeProjectId, null);
    } else {
      setSelectedFlowId(id);
    }
  }

  async function handleModalSubmit(name, groupId) {
    if (creating) return;
    if (!activeProjectId) return;
    setCreating(true);
    try {
      const targetGroupId = groupId !== undefined ? groupId : selectedFlowGroupId;
      const safeGroupId = targetGroupId && allFlowGroupIds.has(targetGroupId) ? targetGroupId : null;
      const created = await createFlow(activeProjectId, {
        name,
        scene: emptyScene(),
        group_id: safeGroupId,
      });
      setFlows((prev) => [...prev, created]);
      // If user picked a different group than the current one, switch the bar
      // so the freshly created flow is visible.
      const createdGroupId = created.group_id || null;
      if (createdGroupId !== selectedFlowGroupId) {
        setSelectedFlowGroupId(createdGroupId);
      }
      setProjectFlowForGroup(activeProjectId, createdGroupId, created.id);
      setProjectFlow(activeProjectId, created.id);
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
    if (!activeProjectId) return;
    markSaving(id, true);
    try {
      const updated = await patchFlow(activeProjectId, id, { name });
      setFlows((prev) => prev.map((f) => (f.id === id ? updated : f)));
    } catch (err) {
      showError(err);
      throw err;
    } finally {
      markSaving(id, false);
    }
  }

  async function handleDuplicate(source) {
    if (!activeProjectId) return;
    markSaving(source.id, true);
    try {
      const name = `${source.name} ${t('flows.copySuffix')}`;
      // Inherit the source's effective group; if the source's stored group id
      // is stale (group deleted), the duplicate lands in "No group" — same
      // bucket the user already saw the source in.
      const inheritedGroupId = effectiveGroupOf(source);
      const created = await createFlow(activeProjectId, {
        name,
        scene: source.scene || emptyScene(),
        group_id: inheritedGroupId,
      });
      setFlows((prev) => [...prev, created]);
      setProjectFlowForGroup(activeProjectId, created.group_id || null, created.id);
      setProjectFlow(activeProjectId, created.id);
      lastSceneRef.current = { id: null, elementsLen: 0, elementsVersion: 0, bgColor: null, filesCount: 0 };
      toast.success(t('success.flow_duplicated'));
    } catch (err) {
      showError(err);
    } finally {
      markSaving(source.id, false);
    }
  }

  async function handleAssignFlowGroup(flowId, groupId) {
    if (!activeProjectId) return;
    const prev = flowsCur;
    const target = prev.find((f) => f.id === flowId);
    if (!target) return;
    const nextGroupId = groupId || null;
    if (nextGroupId && !allFlowGroupIds.has(nextGroupId)) return;
    setFlows((cur) => cur.map((f) => (f.id === flowId ? { ...f, group_id: nextGroupId } : f)));
    try {
      const updated = await patchFlow(activeProjectId, flowId, { group_id: nextGroupId });
      setFlows((cur) => cur.map((f) => (f.id === flowId ? updated : f)));
      setProjectFlowForGroup(activeProjectId, nextGroupId, flowId);
    } catch (err) {
      setFlows(prev);
      showError(err);
    }
  }

  async function handleCreateFlowGroupInline(name) {
    if (!activeProjectId) return null;
    try {
      const created = await createFlowGroup(activeProjectId, name);
      setFlowGroups((prev) => [...prev, created]);
      return created;
    } catch (err) {
      showError(err);
      throw err;
    }
  }

  async function handleReorderFlowGroups(fromId, toId) {
    if (!activeProjectId) return;
    const prev = flowGroupsCur;
    const fromIndex = flowGroupsCur.findIndex((g) => g.id === fromId);
    const toIndex = flowGroupsCur.findIndex((g) => g.id === toId);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
    const optimistic = [...flowGroupsCur];
    const [moved] = optimistic.splice(fromIndex, 1);
    optimistic.splice(toIndex, 0, moved);
    setFlowGroups(optimistic);
    try {
      const res = await reorderFlowGroups(activeProjectId, optimistic);
      const list = Array.isArray(res?.groups) ? res.groups : optimistic;
      setFlowGroups(list);
    } catch (err) {
      setFlowGroups(prev);
      showError(err);
    }
  }

  async function handleHideFlowGroup(groupId) {
    if (!activeProjectId) return;
    const prev = flowGroupsCur;
    if (!flowGroupsCur.some((g) => g.id === groupId)) return;
    setFlowGroups((cur) => cur.map((g) => (g.id === groupId ? { ...g, hidden: true } : g)));
    try {
      await setFlowGroupHidden(activeProjectId, groupId, true);
      toast.success(t('success.flow_group_hidden'));
    } catch (err) {
      setFlowGroups(prev);
      showError(err);
    }
  }

  async function confirmDelete(flow) {
    if (deletingFlowId) return;
    if (!activeProjectId) return;
    setDeletingFlowId(flow.id);
    try {
      await deleteFlow(activeProjectId, flow.id);
      setFlows((prev) => prev.filter((f) => f.id !== flow.id));
      toast.success(t('success.flow_deleted'));
      setToDelete(null);
    } catch (err) {
      showError(err);
    } finally {
      setDeletingFlowId(null);
    }
  }

  // GroupSelector calls these without knowing about projects, so we bind the
  // active project id here before handing them down. Memoized to keep stable
  // references across renders that don't change `activeProjectId`.
  const createFlowGroupAction = useCallback(
    (name) => createFlowGroup(activeProjectId, name),
    [activeProjectId],
  );
  const renameFlowGroupAction = useCallback(
    (id, name) => renameFlowGroup(activeProjectId, id, name),
    [activeProjectId],
  );
  const deleteFlowGroupAction = useCallback(
    (id) => deleteFlowGroup(activeProjectId, id),
    [activeProjectId],
  );
  const setFlowGroupHiddenAction = useCallback(
    (id, hidden) => setFlowGroupHidden(activeProjectId, id, hidden),
    [activeProjectId],
  );

  const excalidrawInitialData = useMemo(() => {
    if (!selectedFlow) return null;
    const scene = selectedFlow.scene || emptyScene();
    // Default viewBackgroundColor to `transparent` so the Excalidraw canvas
    // inherits the themed container background (hsl(var(--background))) below.
    // Users who explicitly set a custom bg color for a flow keep that choice —
    // the spread after preserves scene.appState.viewBackgroundColor if present.
    return {
      elements: Array.isArray(scene.elements) ? scene.elements : [],
      appState: {
        viewBackgroundColor: 'transparent',
        ...(scene.appState || {}),
        collaborators: new Map(),
      },
      files: scene.files || {},
    };
  }, [selectedFlow]);

  const defaultNewName = `Flow ${flowsCur.length + 1}`;

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
          groups={flowGroupsCur}
          getFlowGroupId={effectiveGroupOf}
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
          onAssignGroup={handleAssignFlowGroup}
          onCreateGroupInline={handleCreateFlowGroupInline}
        />

        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          <GroupSelector
            key={activeProjectId}
            groups={flowGroupsCur}
            items={groupSelectorItems}
            getItemGroupId={effectiveGroupOf}
            selectedGroupId={selectedFlowGroupId}
            onSelect={setSelectedFlowGroupId}
            onHideGroup={handleHideFlowGroup}
            onReorder={handleReorderFlowGroups}
            onGroupsChanged={fetchFlowGroups}
            isMobile={isMobile}
            showOpenAll={false}
            createGroupAction={createFlowGroupAction}
            renameGroupAction={renameFlowGroupAction}
            deleteGroupAction={deleteFlowGroupAction}
            setGroupHiddenAction={setFlowGroupHiddenAction}
            deleteConfirmMessageKey="flowGroups.deleteConfirmMessage"
            deleteConfirmMessageZeroKey="flowGroups.deleteConfirmMessageZero"
            successKeys={FLOW_GROUP_SUCCESS_KEYS}
          />
          <div className="flex-1 min-h-0 relative" style={{ background: 'hsl(var(--background))' }}>
            {loading ? (
              <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
                {t('flows.loading')}
              </div>
            ) : !selectedFlow ? (
              <EmptyCanvas t={t} hasAny={flowsInSelectedGroup.length > 0} />
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
          key={activeProjectId}
          onClose={() => setShowModal(false)}
          onSubmit={handleModalSubmit}
          loading={creating}
          fallbackName={defaultNewName}
          groups={flowGroupsCur.filter((g) => !g.hidden)}
          defaultGroupId={selectedFlowGroupId}
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
