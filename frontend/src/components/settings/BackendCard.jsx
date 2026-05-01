'use client';

import { useState } from 'react';
import { Star, Share2, Trash2, Pencil } from 'lucide-react';
import { useTranslation, useErrorToast } from '@/providers/I18nProvider';
import { setDefaultBackend, removeBackend, generateShareToken } from '@/services/api';
import ShareBackendModal from './ShareBackendModal';

export default function BackendCard({ backend, isDefault, projectCount, onChange, onEdit }) {
  const { t } = useTranslation();
  const showError = useErrorToast();
  const [busy, setBusy] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareToken, setShareToken] = useState(null);

  async function handleSetDefault() {
    setBusy(true);
    try {
      await setDefaultBackend(backend.id);
      onChange();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    if (projectCount > 0) {
      showError({ message: t('settings.storage.removeBlocked', { count: projectCount }) });
      return;
    }
    setBusy(true);
    try {
      await removeBackend(backend.id);
      onChange();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleShare() {
    setBusy(true);
    try {
      const token = await generateShareToken(backend.id);
      setShareToken(token);
      setShareModalOpen(true);
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  const driverLabel = backend.driver === 'file'
    ? t('settings.storage.addModal.driverFile')
    : t('settings.storage.addModal.driverS3');

  return (
    <div className="border border-border rounded-lg p-4 bg-card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-medium truncate">{backend.name}</h3>
            {isDefault && <Star className="size-4 text-primary fill-primary shrink-0" />}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {driverLabel} {' · '} {t('settings.storage.projectCount', { count: projectCount })}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {!isDefault && (
            <button
              onClick={handleSetDefault}
              disabled={busy}
              className="px-2 py-1 text-sm rounded hover:bg-accent disabled:opacity-50"
            >
              {t('settings.storage.setDefault')}
            </button>
          )}
          {backend.driver !== 'file' && (
            <button
              onClick={() => onEdit?.(backend)}
              disabled={busy}
              className="p-2 rounded hover:bg-accent disabled:opacity-50"
              aria-label={t('settings.storage.edit')}
              title={t('settings.storage.edit')}
            >
              <Pencil className="size-4" />
            </button>
          )}
          {backend.driver !== 'file' && (
            <button
              onClick={handleShare}
              disabled={busy}
              className="p-2 rounded hover:bg-accent disabled:opacity-50"
              aria-label={t('settings.storage.generateToken')}
              title={t('settings.storage.generateToken')}
            >
              <Share2 className="size-4" />
            </button>
          )}
          {backend.id !== 'local' && (
            <button
              onClick={handleRemove}
              disabled={busy || projectCount > 0}
              className="p-2 rounded hover:bg-destructive/10 text-destructive disabled:opacity-50"
              aria-label={t('settings.storage.remove')}
              title={projectCount > 0 ? t('settings.storage.removeBlocked', { count: projectCount }) : t('settings.storage.remove')}
            >
              <Trash2 className="size-4" />
            </button>
          )}
        </div>
      </div>
      {shareModalOpen && shareToken && (
        <ShareBackendModal
          backendName={backend.name}
          token={shareToken}
          onClose={() => { setShareModalOpen(false); setShareToken(null); }}
        />
      )}
    </div>
  );
}
