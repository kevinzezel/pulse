'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import toast from 'react-hot-toast';
import { SquareKanban } from 'lucide-react';
import {
  listTaskBoards, createTaskBoard, patchTaskBoard, deleteTaskBoard,
  getTaskBoardGroups, reorderTaskBoardGroups,
  createTaskBoardGroup, renameTaskBoardGroup, deleteTaskBoardGroup, setTaskBoardGroupHidden,
} from '@/services/api';
import { useTranslation, useErrorToast } from '@/providers/I18nProvider';
import { useProjects } from '@/providers/ProjectsProvider';
import { useViewState } from '@/providers/ViewStateProvider';
import { useIsMobile } from '@/hooks/layout';
import { ssRead, ssWrite } from '@/lib/sessionState';
import TasksSidebar from '@/components/Tasks/TasksSidebar';
import NewTaskBoardModal from '@/components/Tasks/NewTaskBoardModal';
import TaskBoardCanvas from '@/components/Tasks/TaskBoardCanvas';
import GroupSelector from '@/components/GroupSelector';

const TASK_BOARD_GROUP_SUCCESS_KEYS = Object.freeze({
  created: 'success.task_board_group_created',
  renamed: 'success.task_board_group_renamed',
  deleted: 'success.task_board_group_deleted',
  shown: 'success.task_board_group_shown',
});

const SIDEBAR_OPEN_KEY = 'rt:tasksSidebarOpen';

export default function TasksPage() {
  const { t } = useTranslation();
  const showError = useErrorToast();
  const isMobile = useIsMobile();
  const { activeProjectId } = useProjects();
  const {
    setProjectTaskBoard,
    setProjectTaskBoardGroup,
    setProjectTaskBoardForGroup,
    setProjectTaskBoardEmptyForGroup,
    getProjectTaskBoardGroup,
    getProjectTaskBoardForGroup,
    isProjectTaskBoardEmptyForGroup,
    hydrated: hydratedViewState,
  } = useViewState();

  const [boards, setBoards] = useState([]);
  const [boardGroups, setBoardGroups] = useState([]);
  const [boardsProjectId, setBoardsProjectId] = useState(null);
  const [boardGroupsProjectId, setBoardGroupsProjectId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [creating, setCreating] = useState(false);
  const [savingIds, setSavingIds] = useState(new Set());
  const [toDelete, setToDelete] = useState(null);
  const [deletingBoardId, setDeletingBoardId] = useState(null);
  const [showNewBoardModal, setShowNewBoardModal] = useState(false);
  const [sidebarHydrated, setSidebarHydrated] = useState(false);
  const storageHydrated = sidebarHydrated && hydratedViewState;
  const dataReady = storageHydrated
    && boardsProjectId === activeProjectId
    && boardGroupsProjectId === activeProjectId;

  const allBoardGroupIds = useMemo(
    () => new Set(boardGroups.map((g) => g.id)),
    [boardGroups],
  );

  const visibleBoardGroupIds = useMemo(
    () => new Set(boardGroups.filter((g) => !g.hidden).map((g) => g.id)),
    [boardGroups],
  );

  const rawSelectedBoardGroupId = hydratedViewState ? getProjectTaskBoardGroup(activeProjectId) : null;
  const selectedBoardGroupId = (rawSelectedBoardGroupId && visibleBoardGroupIds.has(rawSelectedBoardGroupId))
    ? rawSelectedBoardGroupId
    : null;

  const setSelectedBoardGroupId = useCallback((id) => {
    if (!activeProjectId) return;
    setProjectTaskBoardGroup(activeProjectId, id);
  }, [activeProjectId, setProjectTaskBoardGroup]);

  const selectedBoardId = hydratedViewState
    ? getProjectTaskBoardForGroup(activeProjectId, selectedBoardGroupId)
    : null;
  const selectedBoardEmpty = hydratedViewState
    ? isProjectTaskBoardEmptyForGroup(activeProjectId, selectedBoardGroupId)
    : false;

  const setSelectedBoardId = useCallback((id) => {
    if (!activeProjectId) return;
    setProjectTaskBoardForGroup(activeProjectId, selectedBoardGroupId, id);
    setProjectTaskBoard(activeProjectId, id);
  }, [activeProjectId, selectedBoardGroupId, setProjectTaskBoardForGroup, setProjectTaskBoard]);

  // Hydrate sidebar open state from sessionStorage so it survives F5 in this tab.
  useEffect(() => {
    const stored = ssRead(SIDEBAR_OPEN_KEY, null);
    setSidebarOpen(typeof stored === 'boolean' ? stored : !isMobile);
    setSidebarHydrated(true);
  }, [isMobile]);

  useEffect(() => {
    if (!sidebarHydrated) return;
    ssWrite(SIDEBAR_OPEN_KEY, sidebarOpen);
  }, [sidebarOpen, sidebarHydrated]);

  const fetchBoardGroups = useCallback(async () => {
    if (!activeProjectId) return;
    try {
      const list = await getTaskBoardGroups(activeProjectId);
      setBoardGroups(Array.isArray(list) ? list : []);
      // Only mark the project as loaded on a real success — otherwise dataReady
      // would flip true with stale/empty groups and hide the failure.
      setBoardGroupsProjectId(activeProjectId);
    } catch (err) {
      showError(err);
    }
  }, [activeProjectId, showError]);

  useEffect(() => {
    if (!storageHydrated) return;
    if (!activeProjectId) return;
    let alive = true;
    const projectId = activeProjectId;
    setLoading(true);
    (async () => {
      try {
        const [boardsList, groupsList] = await Promise.all([
          listTaskBoards(projectId),
          getTaskBoardGroups(projectId),
        ]);
        if (!alive) return;
        setBoards(Array.isArray(boardsList) ? boardsList : []);
        setBoardsProjectId(projectId);
        setBoardGroups(Array.isArray(groupsList) ? groupsList : []);
        setBoardGroupsProjectId(projectId);
      } catch (err) {
        showError(err);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [storageHydrated, showError, activeProjectId]);

  const effectiveGroupOf = useCallback((board) => {
    if (!board) return null;
    const gid = board.group_id;
    if (gid && allBoardGroupIds.has(gid)) return gid;
    return null;
  }, [allBoardGroupIds]);

  useEffect(() => {
    if (!dataReady) return;
    if (!rawSelectedBoardGroupId) return;
    if (visibleBoardGroupIds.has(rawSelectedBoardGroupId)) return;
    setSelectedBoardGroupId(null);
  }, [dataReady, rawSelectedBoardGroupId, visibleBoardGroupIds, setSelectedBoardGroupId]);

  const boardsInSelectedGroup = useMemo(
    () => boards.filter((b) => effectiveGroupOf(b) === selectedBoardGroupId),
    [boards, selectedBoardGroupId, effectiveGroupOf],
  );

  const groupSelectorItems = useMemo(
    () => boards.filter((b) => {
      const gid = effectiveGroupOf(b);
      return gid === null || visibleBoardGroupIds.has(gid);
    }),
    [boards, effectiveGroupOf, visibleBoardGroupIds],
  );

  const filteredBoards = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return boardsInSelectedGroup;
    return boardsInSelectedGroup.filter((b) => b.name.toLowerCase().includes(q));
  }, [boardsInSelectedGroup, searchQuery]);

  useEffect(() => {
    if (!dataReady || loading) return;
    if (selectedBoardId && boardsInSelectedGroup.some((b) => b.id === selectedBoardId)) return;
    if (selectedBoardEmpty) return;
    if (boardsInSelectedGroup.length > 0) {
      setSelectedBoardId(boardsInSelectedGroup[0].id);
    } else {
      setSelectedBoardId(null);
    }
  }, [boardsInSelectedGroup, selectedBoardId, selectedBoardEmpty, dataReady, loading, setSelectedBoardId]);

  const selectedBoard = useMemo(
    () => boardsInSelectedGroup.find((b) => b.id === selectedBoardId) || null,
    [boardsInSelectedGroup, selectedBoardId]
  );

  const assigneeOptions = useMemo(() => {
    const names = new Map();
    for (const board of boards) {
      for (const task of board.tasks || []) {
        const name = String(task.assignee || '').trim();
        if (name) names.set(name.toLowerCase(), name);
      }
    }
    return [...names.values()].sort((a, b) => a.localeCompare(b));
  }, [boards]);

  const markSaving = useCallback((id, isSaving) => {
    setSavingIds((prev) => {
      const next = new Set(prev);
      if (isSaving) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  function handleSelect(id) {
    const isToggleOff = id === selectedBoardId;
    if (isToggleOff) {
      setProjectTaskBoardEmptyForGroup(activeProjectId, selectedBoardGroupId);
      setProjectTaskBoard(activeProjectId, null);
    } else {
      setSelectedBoardId(id);
    }
  }

  async function handleNewBoardSubmit(name, groupId) {
    if (creating) return;
    if (!activeProjectId) return;
    setCreating(true);
    try {
      const targetGroupId = groupId !== undefined ? groupId : selectedBoardGroupId;
      const created = await createTaskBoard(activeProjectId, { name, group_id: targetGroupId });
      setBoards((prev) => [...prev, created]);
      const createdGroupId = created.group_id || null;
      if (createdGroupId !== selectedBoardGroupId) {
        setSelectedBoardGroupId(createdGroupId);
      }
      setProjectTaskBoardForGroup(activeProjectId, createdGroupId, created.id);
      setProjectTaskBoard(activeProjectId, created.id);
      setShowNewBoardModal(false);
      toast.success(t('success.task_board_created'));
    } catch (err) {
      showError(err);
    } finally {
      setCreating(false);
    }
  }

  async function handleRenameBoard(id, name) {
    if (!activeProjectId) return;
    markSaving(id, true);
    try {
      const updated = await patchTaskBoard(activeProjectId, id, { action: 'rename_board', name });
      setBoards((prev) => prev.map((b) => (b.id === id ? updated : b)));
      toast.success(t('success.task_board_renamed'));
    } catch (err) {
      showError(err);
      throw err;
    } finally {
      markSaving(id, false);
    }
  }

  async function handleAssignBoardGroup(boardId, groupId) {
    if (!activeProjectId) return;
    const prev = boards;
    const target = prev.find((b) => b.id === boardId);
    if (!target) return;
    const nextGroupId = groupId || null;
    setBoards((cur) => cur.map((b) => (b.id === boardId ? { ...b, group_id: nextGroupId } : b)));
    try {
      const updated = await patchTaskBoard(activeProjectId, boardId, { action: 'move_board_group', group_id: nextGroupId });
      setBoards((cur) => cur.map((b) => (b.id === boardId ? updated : b)));
      setProjectTaskBoardForGroup(activeProjectId, nextGroupId, boardId);
    } catch (err) {
      setBoards(prev);
      showError(err);
    }
  }

  async function handleCreateBoardGroupInline(name) {
    if (!activeProjectId) return null;
    try {
      const data = await createTaskBoardGroup(activeProjectId, name);
      setBoardGroups((prev) => [...prev, data.group]);
      return data.group;
    } catch (err) {
      showError(err);
      throw err;
    }
  }

  async function handleReorderBoardGroups(fromId, toId) {
    if (!activeProjectId) return;
    const prev = boardGroups;
    const fromIndex = boardGroups.findIndex((g) => g.id === fromId);
    const toIndex = boardGroups.findIndex((g) => g.id === toId);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
    const optimistic = [...boardGroups];
    const [moved] = optimistic.splice(fromIndex, 1);
    optimistic.splice(toIndex, 0, moved);
    setBoardGroups(optimistic);
    try {
      const res = await reorderTaskBoardGroups(activeProjectId, optimistic);
      const list = Array.isArray(res?.groups) ? res.groups : optimistic;
      setBoardGroups(list);
    } catch (err) {
      setBoardGroups(prev);
      showError(err);
    }
  }

  async function handleHideBoardGroup(groupId) {
    if (!activeProjectId) return;
    const prev = boardGroups;
    setBoardGroups((cur) => cur.map((g) => (g.id === groupId ? { ...g, hidden: true } : g)));
    try {
      await setTaskBoardGroupHidden(activeProjectId, groupId, true);
      toast.success(t('success.task_board_group_hidden'));
    } catch (err) {
      setBoardGroups(prev);
      showError(err);
    }
  }

  async function confirmDelete(board) {
    if (deletingBoardId) return;
    if (!activeProjectId) return;
    setDeletingBoardId(board.id);
    try {
      await deleteTaskBoard(activeProjectId, board.id);
      setBoards((prev) => prev.filter((b) => b.id !== board.id));
      toast.success(t('success.task_board_deleted'));
      setToDelete(null);
    } catch (err) {
      showError(err);
    } finally {
      setDeletingBoardId(null);
    }
  }

  function handleBoardUpdate(nextBoard) {
    setBoards((prev) => prev.map((b) => (b.id === nextBoard.id ? nextBoard : b)));
  }

  // GroupSelector calls these without knowing about projects, so we bind the
  // active project id here before handing them down. Memoized to keep stable
  // references across renders that don't change `activeProjectId`.
  const createTaskBoardGroupAction = useCallback(
    (name) => createTaskBoardGroup(activeProjectId, name),
    [activeProjectId],
  );
  const renameTaskBoardGroupAction = useCallback(
    (id, name) => renameTaskBoardGroup(activeProjectId, id, name),
    [activeProjectId],
  );
  const deleteTaskBoardGroupAction = useCallback(
    (id) => deleteTaskBoardGroup(activeProjectId, id),
    [activeProjectId],
  );
  const setTaskBoardGroupHiddenAction = useCallback(
    (id, hidden) => setTaskBoardGroupHidden(activeProjectId, id, hidden),
    [activeProjectId],
  );

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

        <TasksSidebar
          boards={filteredBoards}
          groups={boardGroups}
          getBoardGroupId={effectiveGroupOf}
          selectedBoardId={selectedBoardId}
          savingIds={savingIds}
          creating={creating}
          isOpen={sidebarOpen}
          setIsOpen={setSidebarOpen}
          isMobile={isMobile}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          onSelect={handleSelect}
          onCreate={() => setShowNewBoardModal(true)}
          onRename={handleRenameBoard}
          onDelete={(board) => setToDelete(board)}
          onAssignGroup={handleAssignBoardGroup}
          onCreateGroupInline={handleCreateBoardGroupInline}
        />

        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          <GroupSelector
            groups={boardGroups}
            items={groupSelectorItems}
            getItemGroupId={effectiveGroupOf}
            selectedGroupId={selectedBoardGroupId}
            onSelect={setSelectedBoardGroupId}
            onHideGroup={handleHideBoardGroup}
            onReorder={handleReorderBoardGroups}
            onGroupsChanged={fetchBoardGroups}
            isMobile={isMobile}
            showOpenAll={false}
            createGroupAction={createTaskBoardGroupAction}
            renameGroupAction={renameTaskBoardGroupAction}
            deleteGroupAction={deleteTaskBoardGroupAction}
            setGroupHiddenAction={setTaskBoardGroupHiddenAction}
            deleteConfirmMessageKey="taskBoardGroups.deleteConfirmMessage"
            deleteConfirmMessageZeroKey="taskBoardGroups.deleteConfirmMessageZero"
            successKeys={TASK_BOARD_GROUP_SUCCESS_KEYS}
          />
          <div className="flex-1 min-h-0 relative" style={{ background: 'hsl(var(--background))' }}>
            {loading ? (
              <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
                {t('tasks.loading')}
              </div>
            ) : !selectedBoard ? (
              <EmptyBoard t={t} hasAny={boardsInSelectedGroup.length > 0} />
            ) : (
              <TaskBoardCanvas
                key={selectedBoard.id}
                board={selectedBoard}
                projectId={activeProjectId}
                onBoardUpdate={handleBoardUpdate}
                assigneeOptions={assigneeOptions}
              />
            )}
          </div>
        </div>
      </div>

      {showNewBoardModal && (
        <NewTaskBoardModal
          onClose={() => setShowNewBoardModal(false)}
          onSubmit={handleNewBoardSubmit}
          loading={creating}
          fallbackName={`Board ${boards.length + 1}`}
          groups={boardGroups.filter((g) => !g.hidden)}
          defaultGroupId={selectedBoardGroupId}
        />
      )}

      {toDelete && (
        <DeleteConfirm
          t={t}
          board={toDelete}
          loading={deletingBoardId === toDelete.id}
          onCancel={() => deletingBoardId ? null : setToDelete(null)}
          onConfirm={() => confirmDelete(toDelete)}
        />
      )}
    </div>
  );
}

function EmptyBoard({ t, hasAny }) {
  return (
    <div className="flex flex-col h-full items-center justify-center gap-3 text-center p-8">
      <SquareKanban size={40} className="text-muted-foreground" />
      <p className="text-muted-foreground text-sm max-w-sm">
        {hasAny ? t('tasks.emptyFilter') : t('tasks.empty')}
      </p>
    </div>
  );
}

function DeleteConfirm({ t, board, loading, onCancel, onConfirm }) {
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
        <h3 className="mb-2 text-sm font-semibold">{t('tasks.deleteConfirmTitle')}</h3>
        <p className="mb-4 text-xs text-muted-foreground">
          {t('tasks.deleteConfirmMessage', { name: board.name })}
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={loading}
            className="rounded px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={onCancel}
          >
            {t('tasks.cancel')}
          </button>
          <button
            type="button"
            disabled={loading}
            className="flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60 disabled:cursor-not-allowed"
            style={{ background: 'hsl(var(--destructive))' }}
            onClick={onConfirm}
          >
            {t('tasks.deleteConfirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
