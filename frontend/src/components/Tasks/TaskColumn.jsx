'use client';

import { useState } from 'react';
import { Plus, Pencil, Trash2, Check, X, GripVertical } from 'lucide-react';
import { useDroppable } from '@dnd-kit/core';
import { useSortable, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useTranslation } from '@/providers/I18nProvider';
import TaskCard from './TaskCard';

function SortableTaskCard({ task, assigneeOptions, onClick, onQuickUpdate }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: `task:${task.id}`, data: { type: 'task', taskId: task.id } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <TaskCard
      ref={setNodeRef}
      task={task}
      onClick={onClick}
      assigneeOptions={assigneeOptions}
      onQuickUpdate={onQuickUpdate}
      dragAttributes={attributes}
      dragListeners={listeners}
      style={style}
      isDragging={isDragging}
    />
  );
}

export default function TaskColumn({
  column,
  tasks,
  columnDragHandle,
  onCreateTask,
  onEditColumn,
  onDeleteColumn,
  onTaskClick,
  onQuickUpdateTask,
  assigneeOptions = [],
}) {
  const { t } = useTranslation();
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Make the entire column droppable so dragging a task to an empty column
  // produces a hit even when there are no cards to hover over.
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: `column-drop:${column.id}`,
    data: { type: 'column', columnId: column.id },
  });

  const sortableIds = tasks.map((task) => `task:${task.id}`);
  const isEmpty = tasks.length === 0;

  return (
    <div
      ref={setDroppableRef}
      className={`flex-shrink-0 w-[300px] min-w-[300px] flex flex-col rounded-md border ${
        isOver ? 'ring-2 ring-primary/40' : ''
      }`}
      style={{
        background: 'hsl(var(--sidebar-bg))',
        borderColor: 'hsl(var(--sidebar-border))',
      }}
    >
      <div className="flex items-center gap-1 px-2 py-2 border-b" style={{ borderColor: 'hsl(var(--sidebar-border))' }}>
        {columnDragHandle && (
          <button
            type="button"
            {...(columnDragHandle.attributes || {})}
            {...(columnDragHandle.listeners || {})}
            className="p-1 text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing"
            aria-label={t('tasks.dragColumn')}
            title={t('tasks.dragColumn')}
          >
            <GripVertical size={12} />
          </button>
        )}
        <button
          type="button"
          onClick={() => onEditColumn(column)}
          className="min-w-0 flex-1 truncate text-left text-sm font-medium text-foreground transition-colors hover:text-primary"
          title={column.title}
        >
          {column.title}
        </button>
        <span className="px-1.5 text-[10px] rounded bg-muted/40 text-muted-foreground">
          {tasks.length}
        </span>
        <button
          type="button"
          onClick={() => onEditColumn(column)}
          className="p-1 text-muted-foreground hover:text-foreground transition-colors"
          title={t('tasks.renameColumn')}
        >
          <Pencil size={12} />
        </button>
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          className="p-1 text-muted-foreground hover:text-destructive transition-colors"
          title={t('tasks.deleteColumn')}
        >
          <Trash2 size={12} />
        </button>
      </div>

      <div className="flex-1 min-h-[60px] p-2 flex flex-col gap-2 overflow-y-auto">
        <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <SortableTaskCard
              key={task.id}
              task={task}
              assigneeOptions={assigneeOptions}
              onClick={() => onTaskClick(task.id)}
              onQuickUpdate={onQuickUpdateTask}
            />
          ))}
        </SortableContext>
        {isEmpty && (
          <div
            className="flex-1 min-h-[40px] rounded border border-dashed text-center text-[11px] text-muted-foreground py-3 px-2"
            style={{ borderColor: 'hsl(var(--border))' }}
          >
            {t('tasks.emptyColumn')}
          </div>
        )}
      </div>

      <div className="p-2 border-t" style={{ borderColor: 'hsl(var(--sidebar-border))' }}>
        <button
          type="button"
          onClick={() => onCreateTask(column.id)}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded text-xs text-muted-foreground hover:text-primary hover:bg-muted/40 transition-colors"
        >
          <Plus size={12} />
          {t('tasks.addTask')}
        </button>
      </div>

      {confirmDelete && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          style={{ background: 'hsl(var(--overlay) / 0.6)' }}
          onClick={() => setConfirmDelete(false)}
        >
          <div
            className="w-full max-w-sm rounded-lg border p-4 shadow-xl"
            style={{ background: 'hsl(var(--card))', color: 'hsl(var(--foreground))', borderColor: 'hsl(var(--border))' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-2 text-sm font-semibold">{t('tasks.deleteColumn')}</h3>
            <p className="mb-4 text-xs text-muted-foreground">{column.title}</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="rounded px-3 py-1.5 text-sm hover:bg-muted inline-flex items-center gap-1"
              >
                <X size={12} />
                {t('tasks.cancel')}
              </button>
              <button
                type="button"
                onClick={() => { setConfirmDelete(false); onDeleteColumn(column.id); }}
                className="rounded px-3 py-1.5 text-sm font-medium text-white inline-flex items-center gap-1"
                style={{ background: 'hsl(var(--destructive))' }}
              >
                <Check size={12} />
                {t('tasks.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
