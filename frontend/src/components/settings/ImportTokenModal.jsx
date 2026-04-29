'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation, useErrorToast } from '@/providers/I18nProvider';
import { importBackendToken, importProjects } from '@/services/api';

export default function ImportTokenModal({ onClose, onImported }) {
  const { t } = useTranslation();
  const showError = useErrorToast();
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState('');
  const [rename, setRename] = useState('');
  // Step-2 state — populated after successful validate.
  const [preview, setPreview] = useState(null); // { backend_id, backend_name, projects: [...] }
  const [selected, setSelected] = useState(new Set());

  async function handleValidate() {
    setBusy(true);
    try {
      const result = await importBackendToken({ token, rename: rename || undefined });
      setPreview(result);
      // Default: select all projects
      setSelected(new Set(result.projects.map((p) => p.id)));
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleImport() {
    setBusy(true);
    try {
      const projectsToImport = preview.projects.filter((p) => selected.has(p.id));
      const result = await importProjects({
        backendId: preview.backend_id,
        projects: projectsToImport,
      });
      toast.success(t('settings.storage.importModal.successAdded', {
        added: result.added,
        skipped: result.skipped,
      }));
      onImported();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  function toggle(id) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  function toggleAll() {
    if (preview && selected.size === preview.projects.length) {
      setSelected(new Set());
    } else if (preview) {
      setSelected(new Set(preview.projects.map((p) => p.id)));
    }
  }

  return (
    <div className="fixed inset-0 bg-overlay/60 z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-lg p-6 w-full max-w-lg space-y-3 max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-semibold">{t('settings.storage.importModal.title')}</h3>

        {!preview && (
          <>
            <textarea
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={t('settings.storage.importModal.tokenPlaceholder')}
              rows={5}
              className="w-full px-3 py-2 border border-input rounded bg-background font-mono text-xs break-all"
            />
            <label className="block text-sm">
              <span className="block mb-1">{t('settings.storage.importModal.renameLabel')}</span>
              <input
                value={rename}
                onChange={(e) => setRename(e.target.value)}
                className="w-full px-3 py-2 border border-input rounded bg-background"
              />
            </label>
            <div className="flex gap-2 justify-end">
              <button
                onClick={onClose}
                disabled={busy}
                className="px-3 py-2 text-sm rounded border border-border hover:bg-accent disabled:opacity-50"
              >
                {t('settings.storage.importModal.cancel')}
              </button>
              <button
                onClick={handleValidate}
                disabled={busy || !token.trim()}
                className="px-3 py-2 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {busy ? t('settings.storage.importModal.validating') : t('settings.storage.importModal.validate')}
              </button>
            </div>
          </>
        )}

        {preview && (
          <>
            <p className="text-sm">
              {t('settings.storage.importModal.previewTitle', { count: preview.projects.length })}
            </p>
            <div className="flex justify-end">
              <button onClick={toggleAll} className="text-sm text-primary hover:underline">
                {selected.size === preview.projects.length
                  ? t('settings.storage.importModal.clear')
                  : t('settings.storage.importModal.selectAll')}
              </button>
            </div>
            <div className="max-h-64 overflow-auto border border-border rounded">
              {preview.projects.map((p) => (
                <label key={p.id} className="flex items-center gap-2 p-2 hover:bg-accent cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selected.has(p.id)}
                    onChange={() => toggle(p.id)}
                  />
                  <span className="flex-1 text-sm">{p.name}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={onClose}
                disabled={busy}
                className="px-3 py-2 text-sm rounded border border-border hover:bg-accent disabled:opacity-50"
              >
                {t('settings.storage.importModal.cancel')}
              </button>
              <button
                onClick={handleImport}
                disabled={busy || selected.size === 0}
                className="px-3 py-2 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {busy ? t('settings.storage.importModal.importing') : t('settings.storage.importModal.import')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
