'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from '@/providers/I18nProvider';

export default function NewFlowModal({ onClose, onSubmit, loading, fallbackName = 'Flow' }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');

  function handleSubmit(e) {
    e.preventDefault();
    onSubmit(name.trim() || fallbackName);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/60 px-4">
      <div className="bg-card border border-border rounded-lg p-6 w-full max-w-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-foreground font-semibold">{t('modal.newFlow.title')}</h3>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <label className="block text-sm text-muted-foreground mb-1">
            {t('modal.newFlow.nameLabel')}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('modal.newFlow.placeholder')}
            maxLength={50}
            autoFocus
            disabled={loading}
            className="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring mb-4"
          />

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-2 rounded-md text-sm font-medium text-white bg-brand-gradient hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
            >
              {loading ? t('modal.newFlow.creating') : t('modal.newFlow.create')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
