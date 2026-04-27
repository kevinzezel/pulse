'use client';

import { useState } from 'react';
import { Check, Loader, Settings2, Trash2, X } from 'lucide-react';
import { useTranslation } from '@/providers/I18nProvider';
import {
  TASK_TITLE_MAX,
  TASK_DESCRIPTION_MAX,
  TASK_ASSIGNEE_MAX,
} from '@/lib/taskBoardsConfig';
import TaskMediaPreview from './TaskMediaPreview';

export default function TaskEditorModal({
  task = null,
  onClose,
  onSubmit,
  onDelete,
  onClearAssignee,
  loading,
  deleting,
  assigneeOptions = [],
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(task?.title || '');
  const [description, setDescription] = useState(task?.description || '');
  const [startDate, setStartDate] = useState(task?.start_date || '');
  const [endDate, setEndDate] = useState(task?.end_date || '');
  const [assignee, setAssignee] = useState(task?.assignee || '');
  const [addingAssignee, setAddingAssignee] = useState(false);
  const [assigneeDraft, setAssigneeDraft] = useState('');
  const [managingAssignees, setManagingAssignees] = useState(false);
  const [clearingName, setClearingName] = useState(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const isExisting = Boolean(task && task.id);
  const isBusy = loading || deleting;

  const assigneeSelectOptions = (() => {
    const seen = new Set();
    const out = [];
    for (const name of assigneeOptions) {
      const clean = String(name || '').trim();
      if (!clean || seen.has(clean.toLowerCase())) continue;
      seen.add(clean.toLowerCase());
      out.push(clean);
    }
    const current = assignee.trim();
    if (current && !seen.has(current.toLowerCase())) out.unshift(current);
    return out;
  })();

  function handleSubmit(e) {
    e.preventDefault();
    if (!title.trim()) return;
    onSubmit({
      title: title.trim(),
      description,
      start_date: startDate || null,
      end_date: endDate || null,
      assignee: assignee.trim(),
    });
  }

  async function handleClearAssignee(name) {
    if (!onClearAssignee || clearingName) return;
    setClearingName(name);
    try {
      await onClearAssignee(name);
      // If the editor's currently-selected assignee just got wiped board-wide,
      // mirror that here so the form doesn't keep the deleted name selected.
      if (assignee.trim().toLowerCase() === name.toLowerCase()) {
        setAssignee('');
      }
    } finally {
      setClearingName(null);
    }
  }

  function handleAssigneeSelect(value) {
    if (value === '__add__') {
      setAddingAssignee(true);
      setAssigneeDraft('');
      return;
    }
    setAssignee(value);
  }

  function commitAssignee() {
    setAssignee(assigneeDraft.trim());
    setAddingAssignee(false);
    setAssigneeDraft('');
  }

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: 'hsl(var(--overlay) / 0.6)' }}
      onMouseDown={() => !isBusy && onClose()}
    >
      <div
        className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-lg border p-5 shadow-xl"
        style={{ background: 'hsl(var(--card))', color: 'hsl(var(--foreground))', borderColor: 'hsl(var(--border))' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-semibold text-foreground">
            {isExisting ? t('tasks.editTask') : t('tasks.newTask')}
          </h3>
          <button
            type="button"
            onClick={onClose}
            disabled={isBusy}
            className="text-muted-foreground hover:text-foreground disabled:opacity-50"
            aria-label={t('sidebar.close')}
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">{t('tasks.title')}</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={TASK_TITLE_MAX}
              autoFocus
              disabled={isBusy}
              className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-muted-foreground">{t('tasks.description')}</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={TASK_DESCRIPTION_MAX}
              rows={5}
              disabled={isBusy}
              className="w-full resize-y rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <TaskMediaPreview description={description} />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">{t('tasks.startDate')}</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                disabled={isBusy}
                className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">{t('tasks.endDate')}</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                disabled={isBusy}
                className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="block text-xs text-muted-foreground">{t('tasks.assignee')}</label>
              {onClearAssignee && assigneeSelectOptions.length > 0 && (
                <button
                  type="button"
                  onClick={() => setManagingAssignees((v) => !v)}
                  disabled={isBusy}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-primary disabled:opacity-50"
                  title={t('tasks.manageAssignees')}
                >
                  <Settings2 size={12} />
                  {t('tasks.manageAssignees')}
                </button>
              )}
            </div>
            {addingAssignee ? (
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={assigneeDraft}
                  onChange={(e) => setAssigneeDraft(e.target.value)}
                  maxLength={TASK_ASSIGNEE_MAX}
                  autoFocus
                  placeholder={t('tasks.assigneePlaceholder')}
                  disabled={isBusy}
                  className="min-w-0 flex-1 rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <button
                  type="button"
                  onClick={commitAssignee}
                  disabled={isBusy}
                  className="rounded-md px-2 text-success hover:bg-muted/40 disabled:opacity-50"
                  title={t('tasks.save')}
                >
                  <Check size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => setAddingAssignee(false)}
                  disabled={isBusy}
                  className="rounded-md px-2 text-muted-foreground hover:bg-muted/40 hover:text-foreground disabled:opacity-50"
                  title={t('tasks.cancel')}
                >
                  <X size={15} />
                </button>
              </div>
            ) : (
              <select
                value={assignee}
                onChange={(e) => handleAssigneeSelect(e.target.value)}
                disabled={isBusy}
                className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">{t('tasks.noAssignee')}</option>
                {assigneeSelectOptions.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
                <option value="__add__">{t('tasks.addAssignee')}</option>
              </select>
            )}
            {managingAssignees && onClearAssignee && (
              <div
                className="mt-2 rounded-md border p-2"
                style={{ background: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }}
              >
                <p className="mb-2 text-[11px] text-muted-foreground">
                  {t('tasks.manageAssigneesHint')}
                </p>
                {assigneeSelectOptions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t('tasks.noAssignee')}</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {assigneeSelectOptions.map((name) => (
                      <li
                        key={name}
                        className="flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-muted/40"
                      >
                        <span className="min-w-0 flex-1 truncate">{name}</span>
                        <button
                          type="button"
                          onClick={() => handleClearAssignee(name)}
                          disabled={isBusy || clearingName === name}
                          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-destructive disabled:opacity-50"
                          title={t('tasks.removeAssignee')}
                        >
                          {clearingName === name
                            ? <Loader size={12} className="animate-spin" />
                            : <Trash2 size={12} />}
                          {t('tasks.removeAssignee')}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 pt-2">
            {isExisting && onDelete && (
              confirmingDelete ? (
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => onDelete()}
                  className="inline-flex items-center gap-1.5 rounded px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                  style={{ background: 'hsl(var(--destructive))' }}
                >
                  {deleting ? <Loader size={13} className="animate-spin" /> : <Trash2 size={13} />}
                  {t('tasks.delete')}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => setConfirmingDelete(true)}
                  className="inline-flex items-center gap-1.5 rounded px-3 py-2 text-sm text-muted-foreground hover:text-destructive disabled:opacity-50"
                >
                  <Trash2 size={13} />
                  {t('tasks.delete')}
                </button>
              )
            )}
            <div className="flex-1" />
            <button
              type="button"
              onClick={onClose}
              disabled={isBusy}
              className="rounded border border-border px-3 py-2 text-sm hover:bg-muted/40 disabled:opacity-50"
            >
              {t('tasks.cancel')}
            </button>
            <button
              type="submit"
              disabled={isBusy || !title.trim()}
              className="inline-flex items-center gap-1.5 rounded bg-brand-gradient px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading && <Loader size={13} className="animate-spin" />}
              {isExisting ? (loading ? t('tasks.saving') : t('tasks.save')) : (loading ? t('tasks.creating') : t('tasks.create'))}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
