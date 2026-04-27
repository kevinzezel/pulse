'use client';

import { useState } from 'react';
import { X, Loader } from 'lucide-react';
import { useTranslation } from '@/providers/I18nProvider';
import { BOARD_NAME_MAX } from '@/lib/taskBoardsConfig';

export default function NewTaskBoardModal({
  onClose,
  onSubmit,
  loading,
  fallbackName = 'Board',
  groups = [],
  defaultGroupId = null,
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [groupId, setGroupId] = useState(defaultGroupId);

  function handleSubmit(e) {
    e.preventDefault();
    onSubmit(name.trim() || fallbackName, groupId || null);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/60 px-4">
      <div className="bg-card border border-border rounded-lg p-6 w-full max-w-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-foreground font-semibold">{t('tasks.newBoard')}</h3>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <label className="block text-sm text-muted-foreground mb-1">
            {t('tasks.namePlaceholder')}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('tasks.namePlaceholder')}
            maxLength={BOARD_NAME_MAX}
            autoFocus
            disabled={loading}
            className="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring mb-4"
          />

          <label className="block text-sm text-muted-foreground mb-1">
            {t('tasks.assignGroup')}
          </label>
          <select
            value={groupId || ''}
            onChange={(e) => setGroupId(e.target.value || null)}
            disabled={loading}
            className="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-ring mb-4"
          >
            <option value="">{t('tasks.noGroup')}</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-2 rounded-md text-sm font-medium text-white bg-brand-gradient hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity inline-flex items-center justify-center gap-1.5"
            >
              {loading && <Loader size={13} className="animate-spin" />}
              {loading ? t('tasks.creating') : t('tasks.create')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
