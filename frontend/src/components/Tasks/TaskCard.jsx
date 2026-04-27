'use client';

import { forwardRef, useState } from 'react';
import { Calendar, Check, GripVertical, User, X } from 'lucide-react';
import { useTranslation } from '@/providers/I18nProvider';
import { TASK_ASSIGNEE_MAX } from '@/lib/taskBoardsConfig';
import TaskMediaPreview from './TaskMediaPreview';

function parseLocalDate(dateString) {
  if (typeof dateString !== 'string') return null;
  const [year, month, day] = dateString.split('-').map((part) => Number(part));
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

const TaskCard = forwardRef(function TaskCard(
  {
    task,
    onClick,
    assigneeOptions = [],
    onQuickUpdate,
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
  const [addingAssignee, setAddingAssignee] = useState(false);
  const [assigneeDraft, setAssigneeDraft] = useState('');
  const canEditInline = !isOverlay && typeof onQuickUpdate === 'function';

  const dateSegment = hasDates ? (() => {
    if (task.start_date && task.end_date) {
      const start = parseLocalDate(task.start_date);
      const end = parseLocalDate(task.end_date);
      if (start && end) return `${formatDate(start)} - ${formatDate(end)}`;
    }
    const onlyDate = parseLocalDate(task.start_date || task.end_date);
    return onlyDate ? formatDate(onlyDate) : null;
  })() : null;

  const assigneeSelectOptions = (() => {
    const seen = new Set();
    const out = [];
    for (const name of assigneeOptions) {
      const clean = String(name || '').trim();
      if (!clean || seen.has(clean.toLowerCase())) continue;
      seen.add(clean.toLowerCase());
      out.push(clean);
    }
    const current = String(task.assignee || '').trim();
    if (current && !seen.has(current.toLowerCase())) out.unshift(current);
    return out;
  })();

  function stopControlEvent(e) {
    e.stopPropagation();
  }

  function handleAssigneeChange(value) {
    if (value === '__add__') {
      setAssigneeDraft('');
      setAddingAssignee(true);
      return;
    }
    onQuickUpdate(task.id, { assignee: value });
  }

  function commitAssignee() {
    const clean = assigneeDraft.trim();
    onQuickUpdate(task.id, { assignee: clean });
    setAddingAssignee(false);
    setAssigneeDraft('');
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
      className={`group rounded-md border p-2.5 transition-colors ${
        isOverlay ? 'shadow-xl' : ''
      } ${isDragging ? 'opacity-40' : 'opacity-100'} ${onClick ? 'cursor-pointer' : ''}`}
    >
      <div className="flex items-start gap-2">
        {!isOverlay && (
          <button
            type="button"
            {...(dragAttributes || {})}
            {...(dragListeners || {})}
            onClick={stopControlEvent}
            className="mt-0.5 cursor-grab rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground active:cursor-grabbing"
            title={t('tasks.dragTask')}
            aria-label={t('tasks.dragTask')}
          >
            <GripVertical size={13} />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <div className="break-words text-sm font-medium text-foreground">{task.title}</div>
          {task.description && (
            <div className="mt-1 line-clamp-2 break-words text-xs text-muted-foreground">
              {task.description}
            </div>
          )}
        </div>
      </div>

      <TaskMediaPreview description={task.description} compact />

      <div className="mt-2 space-y-2 text-[11px] text-muted-foreground">
        {canEditInline ? (
          addingAssignee ? (
            <div className="flex gap-1" onClick={stopControlEvent} onPointerDown={stopControlEvent}>
              <input
                type="text"
                value={assigneeDraft}
                onChange={(e) => setAssigneeDraft(e.target.value)}
                maxLength={TASK_ASSIGNEE_MAX}
                autoFocus
                placeholder={t('tasks.assigneePlaceholder')}
                className="min-w-0 flex-1 rounded border border-border bg-input px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <button
                type="button"
                onClick={commitAssignee}
                className="rounded px-1 text-success hover:bg-muted/40"
                title={t('tasks.save')}
              >
                <Check size={13} />
              </button>
              <button
                type="button"
                onClick={() => setAddingAssignee(false)}
                className="rounded px-1 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                title={t('tasks.cancel')}
              >
                <X size={13} />
              </button>
            </div>
          ) : (
            <select
              value={task.assignee || ''}
              onChange={(e) => handleAssigneeChange(e.target.value)}
              onClick={stopControlEvent}
              onPointerDown={stopControlEvent}
              className="w-full rounded border border-border bg-input px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              aria-label={t('tasks.assignee')}
            >
              <option value="">{t('tasks.noAssignee')}</option>
              {assigneeSelectOptions.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
              <option value="__add__">{t('tasks.addAssignee')}</option>
            </select>
          )
        ) : task.assignee ? (
          <span className="inline-flex items-center gap-1 truncate">
            <User size={11} />
            <span className="truncate max-w-[180px]">{task.assignee}</span>
          </span>
        ) : null}

        {canEditInline ? (
          <div className="grid grid-cols-2 gap-1" onClick={stopControlEvent} onPointerDown={stopControlEvent}>
            <input
              type="date"
              value={task.start_date || ''}
              onChange={(e) => onQuickUpdate(task.id, { start_date: e.target.value || null })}
              className="min-w-0 rounded border border-border bg-input px-1.5 py-1 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              aria-label={t('tasks.startDate')}
            />
            <input
              type="date"
              value={task.end_date || ''}
              onChange={(e) => onQuickUpdate(task.id, { end_date: e.target.value || null })}
              className="min-w-0 rounded border border-border bg-input px-1.5 py-1 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              aria-label={t('tasks.endDate')}
            />
          </div>
        ) : dateSegment ? (
          <span className="inline-flex items-center gap-1 truncate">
            <Calendar size={11} />
            <span className="truncate">{dateSegment}</span>
          </span>
        ) : null}
      </div>
    </div>
  );
});

export default TaskCard;
