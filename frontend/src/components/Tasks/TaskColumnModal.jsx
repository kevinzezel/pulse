'use client';

import { useState } from 'react';
import { Loader, X } from 'lucide-react';
import { useTranslation } from '@/providers/I18nProvider';
import { COLUMN_TITLE_MAX } from '@/lib/taskBoardsConfig';

export default function TaskColumnModal({ column = null, loading = false, onClose, onSubmit }) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(column?.title || '');
  const isEditing = Boolean(column);

  function handleSubmit(e) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-overlay/60 px-4">
      <div className="w-full max-w-sm rounded-lg border bg-card p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-semibold text-foreground">
            {isEditing ? t('tasks.renameColumn') : t('tasks.newColumn')}
          </h3>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="text-muted-foreground hover:text-foreground disabled:opacity-50"
            aria-label={t('sidebar.close')}
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <label className="mb-1 block text-sm text-muted-foreground">
            {t('tasks.columnName')}
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={COLUMN_TITLE_MAX}
            autoFocus
            disabled={loading}
            className="mb-4 w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
          />

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="flex-1 rounded-md border border-border py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground disabled:opacity-50"
            >
              {t('tasks.cancel')}
            </button>
            <button
              type="submit"
              disabled={loading || !title.trim()}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-brand-gradient py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading && <Loader size={13} className="animate-spin" />}
              {isEditing ? t('tasks.save') : t('tasks.create')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
