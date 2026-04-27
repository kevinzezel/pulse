'use client';

import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  closestCorners,
  DragOverlay,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Plus } from 'lucide-react';
import { useTranslation, useErrorToast } from '@/providers/I18nProvider';
import { patchTaskBoard } from '@/services/api';
import TaskColumn from './TaskColumn';
import TaskCard from './TaskCard';
import TaskEditorModal from './TaskEditorModal';
import TaskColumnModal from './TaskColumnModal';

function SortableColumn({
  column,
  tasks,
  assigneeOptions,
  onCreateTask,
  onEditColumn,
  onDeleteColumn,
  onTaskClick,
  onQuickUpdateTask,
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: `column:${column.id}`, data: { type: 'column', columnId: column.id } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <TaskColumn
        column={column}
        tasks={tasks}
        assigneeOptions={assigneeOptions}
        columnDragHandle={{ attributes, listeners }}
        onCreateTask={onCreateTask}
        onEditColumn={onEditColumn}
        onDeleteColumn={onDeleteColumn}
        onTaskClick={onTaskClick}
        onQuickUpdateTask={onQuickUpdateTask}
      />
    </div>
  );
}

function ColumnOverlay({ column, tasks }) {
  return (
    <div
      className="flex w-[300px] min-w-[300px] flex-col rounded-md border shadow-xl"
      style={{
        background: 'hsl(var(--sidebar-bg))',
        borderColor: 'hsl(var(--sidebar-border))',
      }}
    >
      <div className="border-b px-3 py-2 text-sm font-medium text-foreground" style={{ borderColor: 'hsl(var(--sidebar-border))' }}>
        {column.title}
      </div>
      <div className="flex flex-col gap-2 p-2">
        {tasks.slice(0, 3).map((task) => (
          <TaskCard key={task.id} task={task} isOverlay />
        ))}
      </div>
    </div>
  );
}

function findColumnByTaskId(board, taskId) {
  return board.columns.find((c) => c.task_ids.includes(taskId)) || null;
}

function applyMoveTaskLocally(board, taskId, toColumnId, overTaskId) {
  const next = {
    ...board,
    columns: board.columns.map((c) => ({ ...c, task_ids: [...c.task_ids] })),
  };
  for (const c of next.columns) {
    const idx = c.task_ids.indexOf(taskId);
    if (idx >= 0) c.task_ids.splice(idx, 1);
  }
  const dest = next.columns.find((c) => c.id === toColumnId);
  if (!dest) return board;
  if (overTaskId) {
    const overIdx = dest.task_ids.indexOf(overTaskId);
    if (overIdx >= 0) {
      dest.task_ids.splice(overIdx, 0, taskId);
    } else {
      dest.task_ids.push(taskId);
    }
  } else {
    dest.task_ids.push(taskId);
  }
  return next;
}

function applyMoveColumnLocally(board, activeId, overId) {
  const fromIdx = board.columns.findIndex((c) => c.id === activeId);
  const toIdx = board.columns.findIndex((c) => c.id === overId);
  if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return board;
  const cols = [...board.columns];
  const [moved] = cols.splice(fromIdx, 1);
  cols.splice(toIdx, 0, moved);
  return { ...board, columns: cols };
}

export default function TaskBoardCanvas({ board, onBoardUpdate, assigneeOptions = [] }) {
  const { t } = useTranslation();
  const showError = useErrorToast();
  const [activeDrag, setActiveDrag] = useState(null);
  const dragSnapshotRef = useRef(null);
  const boardRef = useRef(board);
  const [columnModal, setColumnModal] = useState(null); // null | { mode, column? }
  const [columnSubmitting, setColumnSubmitting] = useState(false);
  const [editorState, setEditorState] = useState(null); // { columnId, taskId? }
  const [taskBusy, setTaskBusy] = useState(false);
  const [taskDeleting, setTaskDeleting] = useState(false);

  useEffect(() => {
    boardRef.current = board;
  }, [board]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const collisionDetection = useCallback((args) => {
    const activeType = args.active?.data?.current?.type;
    if (activeType === 'column') {
      // Column drag — only consider sibling columns.
      const columnDroppables = args.droppableContainers.filter((container) =>
        String(container.id).startsWith('column:')
      );
      return closestCenter({ ...args, droppableContainers: columnDroppables });
    }

    if (activeType === 'task') {
      // Multi-list sortable: consider task slots and column drop-zones together
      // and pick the one with the closest corner to the pointer. closestCorners
      // is the dnd-kit recommendation for Kanban-style boards because it stays
      // robust regardless of drag direction (left ↔ right, up ↔ down) and
      // doesn't need the cursor to land exactly inside a droppable rect.
      const taskAndColumnDrop = args.droppableContainers.filter((container) => {
        const id = String(container.id);
        return id.startsWith('task:') || id.startsWith('column-drop:');
      });
      return closestCorners({ ...args, droppableContainers: taskAndColumnDrop });
    }

    return closestCorners(args);
  }, []);

  const tasksById = useMemo(() => {
    const map = new Map();
    for (const t of board.tasks) map.set(t.id, t);
    return map;
  }, [board.tasks]);

  const tasksForColumn = useCallback((columnId) => {
    const column = board.columns.find((c) => c.id === columnId);
    if (!column) return [];
    return column.task_ids.map((tid) => tasksById.get(tid)).filter(Boolean);
  }, [board.columns, tasksById]);

  function handleDragStart(event) {
    const { active } = event;
    dragSnapshotRef.current = boardRef.current;
    if (typeof active.id === 'string') {
      if (active.id.startsWith('task:')) {
        const taskId = active.id.slice('task:'.length);
        setActiveDrag({ type: 'task', taskId });
        return;
      }
      if (active.id.startsWith('column:')) {
        const columnId = active.id.slice('column:'.length);
        setActiveDrag({ type: 'column', columnId });
      }
    }
  }

  // No `onDragOver` handler: optimistic cross-column moves while hovering
  // confused dnd-kit's tracking of the active sortable item (the source
  // SortableContext lost it once the task hopped containers, so the drop
  // never produced a usable `over` and the move silently reverted). The
  // DragOverlay already shows the card following the cursor; the actual
  // mutation runs once on drop in handleDragEnd.

  async function handleDragEnd(event) {
    const { active, over } = event;
    setActiveDrag(null);
    if (!active || !over) {
      dragSnapshotRef.current = null;
      return;
    }
    const activeId = String(active.id);
    const overId = String(over.id);
    const currentBoard = boardRef.current;

    if (activeId.startsWith('column:') && overId.startsWith('column:')) {
      const a = activeId.slice('column:'.length);
      const o = overId.slice('column:'.length);
      if (a === o) {
        dragSnapshotRef.current = null;
        return;
      }
      const next = applyMoveColumnLocally(currentBoard, a, o);
      onBoardUpdate(next);
      boardRef.current = next;
      try {
        const updated = await patchTaskBoard(currentBoard.id, { action: 'move_column', active_id: a, over_id: o });
        onBoardUpdate(updated);
        boardRef.current = updated;
      } catch (err) {
        if (dragSnapshotRef.current) {
          onBoardUpdate(dragSnapshotRef.current);
          boardRef.current = dragSnapshotRef.current;
        }
        showError(err);
      } finally {
        dragSnapshotRef.current = null;
      }
      return;
    }

    if (activeId.startsWith('task:')) {
      const taskId = activeId.slice('task:'.length);
      let toColumnId = null;
      let overTaskId = null;
      if (overId.startsWith('task:')) {
        const otherTaskId = overId.slice('task:'.length);
        if (otherTaskId === taskId) {
          dragSnapshotRef.current = null;
          return;
        }
        const sourceColumn = findColumnByTaskId(currentBoard, otherTaskId);
        if (sourceColumn) {
          toColumnId = sourceColumn.id;
          overTaskId = otherTaskId;
        }
      } else if (overId.startsWith('column-drop:')) {
        toColumnId = overId.slice('column-drop:'.length);
      } else if (overId.startsWith('column:')) {
        toColumnId = overId.slice('column:'.length);
      }
      if (!toColumnId) {
        dragSnapshotRef.current = null;
        return;
      }
      const sourceCol = findColumnByTaskId(currentBoard, taskId);
      const sameCol = sourceCol && sourceCol.id === toColumnId;
      // Same-column drop without a meaningful over target → no-op; same-column
      // drop on the task's own slot is also a no-op.
      if (sameCol && (!overTaskId || overTaskId === taskId)) {
        dragSnapshotRef.current = null;
        return;
      }
      const next = applyMoveTaskLocally(currentBoard, taskId, toColumnId, overTaskId);
      onBoardUpdate(next);
      boardRef.current = next;
      try {
        const updated = await patchTaskBoard(currentBoard.id, {
          action: 'move_task',
          task_id: taskId,
          to_column_id: toColumnId,
          over_task_id: overTaskId || null,
        });
        onBoardUpdate(updated);
        boardRef.current = updated;
      } catch (err) {
        if (dragSnapshotRef.current) {
          onBoardUpdate(dragSnapshotRef.current);
          boardRef.current = dragSnapshotRef.current;
        }
        showError(err);
      } finally {
        dragSnapshotRef.current = null;
      }
      return;
    }

    dragSnapshotRef.current = null;
  }

  function handleDragCancel() {
    setActiveDrag(null);
    dragSnapshotRef.current = null;
  }

  async function handleColumnModalSubmit(title) {
    const trimmed = title.trim();
    if (!trimmed || columnSubmitting) return;
    setColumnSubmitting(true);
    try {
      const action = columnModal?.mode === 'rename'
        ? { action: 'rename_column', column_id: columnModal.column.id, title: trimmed }
        : { action: 'create_column', title: trimmed };
      const updated = await patchTaskBoard(boardRef.current.id, action);
      onBoardUpdate(updated);
      boardRef.current = updated;
      setColumnModal(null);
    } catch (err) {
      showError(err);
    } finally {
      setColumnSubmitting(false);
    }
  }

  async function handleDeleteColumn(columnId) {
    try {
      const updated = await patchTaskBoard(boardRef.current.id, { action: 'delete_column', column_id: columnId });
      onBoardUpdate(updated);
      boardRef.current = updated;
    } catch (err) {
      showError(err);
    }
  }

  function openCreateTask(columnId) {
    setEditorState({ columnId, taskId: null });
  }

  function openEditTask(taskId) {
    const column = findColumnByTaskId(board, taskId);
    setEditorState({ columnId: column?.id || null, taskId });
  }

  async function submitEditor(payload) {
    if (!editorState) return;
    setTaskBusy(true);
    try {
      let updated;
      if (editorState.taskId) {
        updated = await patchTaskBoard(boardRef.current.id, {
          action: 'update_task',
          task_id: editorState.taskId,
          task: payload,
        });
      } else {
        updated = await patchTaskBoard(boardRef.current.id, {
          action: 'create_task',
          column_id: editorState.columnId,
          task: payload,
        });
      }
      onBoardUpdate(updated);
      boardRef.current = updated;
      setEditorState(null);
    } catch (err) {
      showError(err);
    } finally {
      setTaskBusy(false);
    }
  }

  async function clearAssigneeBoardWide(name) {
    try {
      const updated = await patchTaskBoard(boardRef.current.id, {
        action: 'bulk_clear_assignee',
        assignee: name,
      });
      onBoardUpdate(updated);
      boardRef.current = updated;
    } catch (err) {
      showError(err);
    }
  }

  async function deleteEditorTask() {
    if (!editorState?.taskId) return;
    setTaskDeleting(true);
    try {
      const updated = await patchTaskBoard(boardRef.current.id, {
        action: 'delete_task',
        task_id: editorState.taskId,
      });
      onBoardUpdate(updated);
      boardRef.current = updated;
      setEditorState(null);
    } catch (err) {
      showError(err);
    } finally {
      setTaskDeleting(false);
    }
  }

  async function handleQuickUpdateTask(taskId, patch) {
    const previous = boardRef.current;
    const target = previous.tasks.find((task) => task.id === taskId);
    if (!target) return;
    const optimistic = {
      ...previous,
      tasks: previous.tasks.map((task) => (
        task.id === taskId ? { ...task, ...patch } : task
      )),
    };
    onBoardUpdate(optimistic);
    boardRef.current = optimistic;
    try {
      const updated = await patchTaskBoard(previous.id, {
        action: 'update_task',
        task_id: taskId,
        task: patch,
      });
      onBoardUpdate(updated);
      boardRef.current = updated;
    } catch (err) {
      onBoardUpdate(previous);
      boardRef.current = previous;
      showError(err);
    }
  }

  const columnSortableIds = board.columns.map((c) => `column:${c.id}`);

  const overlay = activeDrag?.type === 'task'
    ? (() => {
        const task = tasksById.get(activeDrag.taskId);
        if (!task) return null;
        return <TaskCard task={task} isOverlay />;
      })()
    : activeDrag?.type === 'column'
      ? (() => {
          const column = board.columns.find((c) => c.id === activeDrag.columnId);
          if (!column) return null;
          return <ColumnOverlay column={column} tasks={tasksForColumn(column.id)} />;
        })()
      : null;

  const editorTask = editorState?.taskId
    ? board.tasks.find((task) => task.id === editorState.taskId) || null
    : null;

  return (
    <div className="flex-1 min-h-0 flex flex-col" style={{ background: 'hsl(var(--background))' }}>
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden">
          <div className="h-full p-3 flex items-stretch gap-3">
            <SortableContext items={columnSortableIds} strategy={horizontalListSortingStrategy}>
              {board.columns.map((column) => (
                <SortableColumn
                  key={column.id}
                  column={column}
                  tasks={tasksForColumn(column.id)}
                  assigneeOptions={assigneeOptions}
                  onCreateTask={openCreateTask}
                  onEditColumn={(col) => setColumnModal({ mode: 'rename', column: col })}
                  onDeleteColumn={handleDeleteColumn}
                  onTaskClick={openEditTask}
                  onQuickUpdateTask={handleQuickUpdateTask}
                />
              ))}
            </SortableContext>
            <div className="flex-shrink-0 w-[300px] min-w-[300px] flex flex-col">
              <button
                type="button"
                onClick={() => setColumnModal({ mode: 'create' })}
                className="rounded-md border border-dashed py-3 px-2 inline-flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-primary hover:border-primary/50 transition-colors"
                style={{ borderColor: 'hsl(var(--border))' }}
              >
                <Plus size={12} />
                {t('tasks.addColumn')}
              </button>
            </div>
          </div>
        </div>
        <DragOverlay>{overlay}</DragOverlay>
      </DndContext>

      {editorState && (
        <TaskEditorModal
          task={editorTask}
          onClose={() => !taskBusy && !taskDeleting && setEditorState(null)}
          onSubmit={submitEditor}
          onDelete={editorTask ? deleteEditorTask : null}
          onClearAssignee={clearAssigneeBoardWide}
          loading={taskBusy}
          deleting={taskDeleting}
          assigneeOptions={assigneeOptions}
        />
      )}

      {columnModal && (
        <TaskColumnModal
          column={columnModal.mode === 'rename' ? columnModal.column : null}
          loading={columnSubmitting}
          onClose={() => !columnSubmitting && setColumnModal(null)}
          onSubmit={handleColumnModalSubmit}
        />
      )}
    </div>
  );
}
