'use client';

import { useState } from 'react';
import { X, Loader } from 'lucide-react';
import { useTranslation } from '@/providers/I18nProvider';

export default function RenameFlowModal({ flow, onClose, onSubmit, loading }) {
  const { t } = useTranslation();
  const [name, setName] = useState(flow?.name || '');

  function handleSubmit(e) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || trimmed === flow?.name) {
      onClose();
      return;
    }
    onSubmit(trimmed);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/60 px-4">
      <div className="bg-card border border-border rounded-lg p-6 w-full max-w-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-foreground font-semibold">{t('modal.renameFlow.title')}</h3>
          <button
            onClick={onClose}
            disabled={loading}
            className="text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <label className="block text-sm text-muted-foreground mb-1">
            {t('modal.renameFlow.nameLabel')}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
            placeholder={t('modal.renameFlow.placeholder')}
            maxLength={50}
            autoFocus
            disabled={loading}
            className="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring mb-4 disabled:opacity-50"
          />

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="flex-1 py-2 rounded-md text-sm font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-50"
            >
              {t('modal.renameFlow.cancel')}
            </button>
            <button
              type="submit"
              disabled={loading || !name.trim()}
              className="flex-1 py-2 rounded-md text-sm font-medium text-white bg-brand-gradient hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity inline-flex items-center justify-center gap-1.5"
            >
              {loading && <Loader size={13} className="animate-spin" />}
              {loading ? t('modal.renameFlow.saving') : t('modal.renameFlow.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
