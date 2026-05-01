'use client';

import { useState } from 'react';
import {
  Calendar,
  Download,
  ExternalLink,
  FileText,
  Loader,
  Pencil,
  Trash2,
  User,
  X,
} from 'lucide-react';
import { useTranslation } from '@/providers/I18nProvider';
import TaskMarkdown, { extractMarkdownImageUrls } from './TaskMarkdown';

// Read-first modal for an existing task. The user clicks a card and lands
// here -- description rendered as safe Markdown, non-inline images shown in a
// gallery, document attachments listed with click-to-open links. Edit / Delete
// are gated behind explicit buttons so the common "I just want to read this
// card" path doesn't accidentally start a mutation.

function formatBytes(n) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} kB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function parseLocalDate(dateString) {
  if (typeof dateString !== 'string') return null;
  const [year, month, day] = dateString.split('-').map((part) => Number(part));
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

export default function TaskViewModal({
  task,
  onClose,
  onEdit,
  onDelete,
  deleting = false,
}) {
  const { t, formatDate } = useTranslation();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const attachments = Array.isArray(task?.attachments) ? task.attachments : [];
  const images = attachments.filter((a) => a.kind === 'image');
  const documents = attachments.filter((a) => a.kind !== 'image');
  const descriptionText = typeof task?.description === 'string' ? task.description : '';
  const embeddedImageUrls = extractMarkdownImageUrls(descriptionText);
  const galleryImages = images.filter((a) => !embeddedImageUrls.has(a.url));

  const start = parseLocalDate(task?.start_date);
  const end = parseLocalDate(task?.end_date);
  const dateLabel = (() => {
    if (start && end) return `${formatDate(start)} → ${formatDate(end)}`;
    if (start) return formatDate(start);
    if (end) return formatDate(end);
    return null;
  })();

  const assignee = String(task?.assignee || '').trim();

  function handleConfirmDelete() {
    if (!onDelete) return;
    onDelete();
  }

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: 'hsl(var(--overlay) / 0.6)' }}
      onMouseDown={() => !deleting && onClose()}
    >
      <div
        className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-lg border p-6 shadow-xl"
        style={{ background: 'hsl(var(--card))', color: 'hsl(var(--foreground))', borderColor: 'hsl(var(--border))' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <h2 className="break-words text-xl font-semibold leading-snug text-foreground">
            {task?.title || ''}
          </h2>
          <div className="flex flex-shrink-0 items-center gap-2">
            {onEdit && (
              <button
                type="button"
                onClick={onEdit}
                disabled={deleting}
                className="inline-flex items-center gap-1.5 rounded border border-border bg-card px-3 py-1.5 text-sm font-medium hover:border-primary/40 hover:text-primary disabled:opacity-50"
                title={t('tasks.edit')}
              >
                <Pencil size={13} />
                {t('tasks.edit')}
              </button>
            )}
            {onDelete && (
              confirmingDelete ? (
                <button
                  type="button"
                  onClick={handleConfirmDelete}
                  disabled={deleting}
                  className="inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
                  style={{ background: 'hsl(var(--destructive))' }}
                >
                  {deleting ? <Loader size={13} className="animate-spin" /> : <Trash2 size={13} />}
                  {t('tasks.delete')}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(true)}
                  disabled={deleting}
                  className="inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm text-muted-foreground hover:text-destructive disabled:opacity-50"
                >
                  <Trash2 size={13} />
                  {t('tasks.delete')}
                </button>
              )
            )}
            <button
              type="button"
              onClick={onClose}
              disabled={deleting}
              className="rounded p-1.5 text-muted-foreground hover:text-foreground disabled:opacity-50"
              aria-label={t('sidebar.close')}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {(dateLabel || assignee) && (
          <div className="mb-5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            {dateLabel && (
              <span className="inline-flex items-center gap-1.5 rounded bg-muted/40 px-2 py-1">
                <Calendar size={12} />
                {dateLabel}
              </span>
            )}
            {assignee && (
              <span className="inline-flex items-center gap-1.5 rounded bg-muted/40 px-2 py-1">
                <User size={12} />
                {assignee}
              </span>
            )}
          </div>
        )}

        {descriptionText.trim() ? (
          <TaskMarkdown source={descriptionText} className="mb-5" />
        ) : (
          <p className="mb-5 text-sm italic text-muted-foreground">{t('tasks.noDescription')}</p>
        )}

        {galleryImages.length > 0 && (
          <section className="mb-5">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t('tasks.imagesTitle')}
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {galleryImages.map((att) => (
                <a
                  key={att.id}
                  href={att.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex flex-col overflow-hidden rounded-md border bg-muted/20 transition-colors hover:border-primary/50"
                  style={{ borderColor: 'hsl(var(--border))' }}
                  title={t('tasks.openAttachment')}
                >
                  <div className="flex h-56 items-center justify-center bg-muted/30">
                    <img
                      src={att.url}
                      alt={att.name || ''}
                      loading="lazy"
                      className="max-h-full max-w-full object-contain"
                    />
                  </div>
                  <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                    <span className="min-w-0 flex-1 truncate" title={att.name}>{att.name}</span>
                    {att.size > 0 && <span className="shrink-0">{formatBytes(att.size)}</span>}
                    <ExternalLink size={11} className="shrink-0 opacity-60 group-hover:opacity-100" />
                  </div>
                </a>
              ))}
            </div>
          </section>
        )}

        {documents.length > 0 && (
          <section className="mb-2">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t('tasks.documentsTitle')}
            </h3>
            <ul className="flex flex-col gap-1.5">
              {documents.map((att) => (
                <li key={att.id}>
                  <a
                    href={att.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    download={att.name}
                    className="group flex items-center gap-3 rounded-md border bg-muted/10 px-3 py-2 text-sm transition-colors hover:border-primary/40 hover:bg-muted/30"
                    style={{ borderColor: 'hsl(var(--border))' }}
                    title={t('tasks.openAttachment')}
                  >
                    <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
                      <FileText size={15} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-foreground" title={att.name}>{att.name}</div>
                      {att.size > 0 && (
                        <div className="text-[11px] text-muted-foreground">{formatBytes(att.size)}</div>
                      )}
                    </div>
                    <Download size={14} className="shrink-0 text-muted-foreground group-hover:text-primary" />
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
