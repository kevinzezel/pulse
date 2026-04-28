'use client';

import { forwardRef } from 'react';
import { Calendar, GripVertical } from 'lucide-react';
import { useTranslation } from '@/providers/I18nProvider';
import TaskMediaPreview from './TaskMediaPreview';

function parseLocalDate(dateString) {
  if (typeof dateString !== 'string') return null;
  const [year, month, day] = dateString.split('-').map((part) => Number(part));
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function getAssigneeInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0].charAt(0)}${parts[parts.length - 1].charAt(0)}`.toUpperCase();
}

const TaskCard = forwardRef(function TaskCard(
  {
    task,
    onClick,
    dragAttributes,
    dragListeners,
    style,
    isDragging,
    isOverlay = false,
  },
  ref,
) {
  const { t, formatDate } = useTranslation();
  const hasDates = task.start_date || task.end_date;
  const assignee = String(task.assignee || '').trim();
  const assigneeInitials = getAssigneeInitials(assignee);

  const dateSegment = hasDates ? (() => {
    if (task.start_date && task.end_date) {
      const start = parseLocalDate(task.start_date);
      const end = parseLocalDate(task.end_date);
      if (start && end) return `${formatDate(start)} - ${formatDate(end)}`;
    }
    const onlyDate = parseLocalDate(task.start_date || task.end_date);
    return onlyDate ? formatDate(onlyDate) : null;
  })() : null;

  function stopControlEvent(e) {
    e.stopPropagation();
  }

  return (
    <div
      ref={ref}
      style={{
        ...(style || {}),
        background: 'hsl(var(--card))',
        borderColor: 'hsl(var(--border))',
      }}
      onClick={onClick}
      className={`group rounded-md border p-2.5 shadow-sm transition-all ${
        isOverlay ? 'shadow-xl ring-1 ring-primary/20' : 'hover:border-primary/30 hover:shadow-md'
      } ${isDragging ? 'opacity-40' : 'opacity-100'} ${onClick ? 'cursor-pointer' : ''}`}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="break-words text-sm font-medium leading-snug text-foreground">{task.title}</div>
          {task.description && (
            <div className="mt-1 line-clamp-2 break-words text-xs text-muted-foreground">
              {task.description}
            </div>
          )}
        </div>
        {!isOverlay && (
          <button
            type="button"
            {...(dragAttributes || {})}
            {...(dragListeners || {})}
            onClick={stopControlEvent}
            className="-mr-1 -mt-0.5 flex-shrink-0 cursor-grab rounded p-1 text-muted-foreground opacity-60 transition-colors hover:bg-muted/50 hover:text-foreground group-hover:opacity-100 active:cursor-grabbing"
            title={t('tasks.dragTask')}
            aria-label={t('tasks.dragTask')}
          >
            <GripVertical size={13} />
          </button>
        )}
      </div>

      <TaskMediaPreview description={task.description} compact />

      {(dateSegment || assigneeInitials) && (
        <div className="mt-2 flex min-h-6 items-center gap-2">
          <div className="min-w-0 flex-1">
            {dateSegment && (
              <span
                className="inline-flex max-w-full items-center gap-1 rounded bg-muted/50 px-1.5 py-0.5 text-[11px] text-muted-foreground"
                title={dateSegment}
              >
                <Calendar size={11} className="flex-shrink-0" />
                <span className="truncate">{dateSegment}</span>
              </span>
            )}
          </div>
          {assigneeInitials && (
            <span
              className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary ring-1 ring-primary/30"
              title={assignee}
              aria-label={`${t('tasks.assignee')}: ${assignee}`}
            >
              {assigneeInitials}
            </span>
          )}
        </div>
      )}
    </div>
  );
});

export default TaskCard;
