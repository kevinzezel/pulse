'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation, useErrorToast } from '@/providers/I18nProvider';
import { addBackend, importBackendToken } from '@/services/api';

// Single modal that handles both flows for bringing a backend in:
//
// 1. Form mode  — fill in driver-specific credentials manually.
// 2. Token mode — paste a `pulsebackend://v1/...` share token; the server
//    decodes it, pings the backend, and registers it locally. Manifest-as-
//    truth (v4.2) means the projects on that backend show up automatically
//    on the next /api/projects refresh, no separate import step needed.
export default function AddBackendModal({ onClose, onAdded }) {
  const { t } = useTranslation();
  const showError = useErrorToast();
  const [mode, setMode] = useState('form'); // 'form' | 'token'
  const [busy, setBusy] = useState(false);

  // Form-mode state
  const [driver, setDriver] = useState('s3');
  const [name, setName] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [bucket, setBucket] = useState('');
  const [region, setRegion] = useState('us-east-1');
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const [prefix, setPrefix] = useState('');
  const [forcePathStyle, setForcePathStyle] = useState(false);
  const [uri, setUri] = useState('');
  const [database, setDatabase] = useState('pulse');

  // Token-mode state
  const [token, setToken] = useState('');
  const [rename, setRename] = useState('');

  async function handleSubmitForm(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const config = driver === 's3'
        ? {
            endpoint: endpoint || undefined,
            bucket,
            region,
            access_key_id: accessKeyId,
            secret_access_key: secretAccessKey,
            prefix,
            force_path_style: forcePathStyle,
          }
        : { uri, database };
      await addBackend({ name, driver, config });
      toast.success(t('settings.storage.addModal.successAdded', { name }));
      onAdded();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmitToken(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await importBackendToken({ token, rename: rename || undefined });
      // result: { backend_id, backend_name, projects: [...] }
      const projectCount = (result.projects || []).length;
      toast.success(t('settings.storage.addModal.successImported', {
        name: result.backend_name,
        count: projectCount,
      }));
      onAdded();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-overlay/60 z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-lg p-6 w-full max-w-md space-y-3 max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-semibold">{t('settings.storage.addModal.title')}</h3>

        <div className="flex gap-1 p-1 bg-muted/40 rounded-md text-xs">
          <button
            type="button"
            onClick={() => setMode('form')}
            disabled={busy}
            className={`flex-1 px-3 py-1.5 rounded transition-colors disabled:opacity-50 ${
              mode === 'form' ? 'bg-card shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t('settings.storage.addModal.modeForm')}
          </button>
          <button
            type="button"
            onClick={() => setMode('token')}
            disabled={busy}
            className={`flex-1 px-3 py-1.5 rounded transition-colors disabled:opacity-50 ${
              mode === 'token' ? 'bg-card shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t('settings.storage.addModal.modeToken')}
          </button>
        </div>

        {mode === 'form' && (
          <form onSubmit={handleSubmitForm} className="space-y-3">
            <label className="block text-sm">
              <span className="block mb-1">{t('settings.storage.addModal.name')}</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full px-3 py-2 border border-input rounded bg-background"
              />
            </label>

            <label className="block text-sm">
              <span className="block mb-1">{t('settings.storage.addModal.driver')}</span>
              <select
                value={driver}
                onChange={(e) => setDriver(e.target.value)}
                className="w-full px-3 py-2 border border-input rounded bg-background"
              >
                <option value="s3">{t('settings.storage.addModal.driverS3')}</option>
                <option value="mongo">{t('settings.storage.addModal.driverMongo')}</option>
              </select>
            </label>

            {driver === 's3' && (
              <>
                <label className="block text-sm">
                  <span className="block mb-1">{t('settings.storage.addModal.endpoint')}</span>
                  <input
                    value={endpoint}
                    onChange={(e) => setEndpoint(e.target.value)}
                    placeholder="https://s3.amazonaws.com"
                    className="w-full px-3 py-2 border border-input rounded bg-background"
                  />
                </label>
                <label className="block text-sm">
                  <span className="block mb-1">{t('settings.storage.addModal.bucket')}</span>
                  <input
                    value={bucket}
                    onChange={(e) => setBucket(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-input rounded bg-background"
                  />
                </label>
                <label className="block text-sm">
                  <span className="block mb-1">{t('settings.storage.addModal.region')}</span>
                  <input
                    value={region}
                    onChange={(e) => setRegion(e.target.value)}
                    className="w-full px-3 py-2 border border-input rounded bg-background"
                  />
                </label>
                <label className="block text-sm">
                  <span className="block mb-1">{t('settings.storage.addModal.accessKeyId')}</span>
                  <input
                    value={accessKeyId}
                    onChange={(e) => setAccessKeyId(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-input rounded bg-background font-mono text-xs"
                  />
                </label>
                <label className="block text-sm">
                  <span className="block mb-1">{t('settings.storage.addModal.secretAccessKey')}</span>
                  <input
                    type="password"
                    value={secretAccessKey}
                    onChange={(e) => setSecretAccessKey(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-input rounded bg-background font-mono text-xs"
                  />
                </label>
                <label className="block text-sm">
                  <span className="block mb-1">{t('settings.storage.addModal.prefix')}</span>
                  <input
                    value={prefix}
                    onChange={(e) => setPrefix(e.target.value)}
                    className="w-full px-3 py-2 border border-input rounded bg-background"
                  />
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={forcePathStyle}
                    onChange={(e) => setForcePathStyle(e.target.checked)}
                  />
                  {t('settings.storage.addModal.forcePathStyle')}
                </label>
              </>
            )}

            {driver === 'mongo' && (
              <>
                <label className="block text-sm">
                  <span className="block mb-1">{t('settings.storage.addModal.uri')}</span>
                  <input
                    value={uri}
                    onChange={(e) => setUri(e.target.value)}
                    required
                    placeholder="mongodb://..."
                    className="w-full px-3 py-2 border border-input rounded bg-background font-mono text-xs"
                  />
                </label>
                <label className="block text-sm">
                  <span className="block mb-1">{t('settings.storage.addModal.database')}</span>
                  <input
                    value={database}
                    onChange={(e) => setDatabase(e.target.value)}
                    className="w-full px-3 py-2 border border-input rounded bg-background"
                  />
                </label>
              </>
            )}

            <div className="flex gap-2 justify-end pt-2">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="px-3 py-2 text-sm rounded border border-border hover:bg-accent disabled:opacity-50"
              >
                {t('settings.storage.addModal.cancel')}
              </button>
              <button
                type="submit"
                disabled={busy}
                className="px-3 py-2 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {busy ? t('settings.storage.addModal.validating') : t('settings.storage.addModal.validate')}
              </button>
            </div>
          </form>
        )}

        {mode === 'token' && (
          <form onSubmit={handleSubmitToken} className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {t('settings.storage.addModal.tokenHelp')}
            </p>
            <label className="block text-sm">
              <span className="block mb-1">{t('settings.storage.addModal.tokenLabel')}</span>
              <textarea
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={t('settings.storage.addModal.tokenPlaceholder')}
                rows={5}
                required
                className="w-full px-3 py-2 border border-input rounded bg-background font-mono text-xs break-all"
              />
            </label>
            <label className="block text-sm">
              <span className="block mb-1">{t('settings.storage.addModal.tokenRenameLabel')}</span>
              <input
                value={rename}
                onChange={(e) => setRename(e.target.value)}
                placeholder={t('settings.storage.addModal.tokenRenamePlaceholder')}
                className="w-full px-3 py-2 border border-input rounded bg-background"
              />
            </label>
            <div className="flex gap-2 justify-end pt-2">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="px-3 py-2 text-sm rounded border border-border hover:bg-accent disabled:opacity-50"
              >
                {t('settings.storage.addModal.cancel')}
              </button>
              <button
                type="submit"
                disabled={busy || !token.trim()}
                className="px-3 py-2 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {busy ? t('settings.storage.addModal.importing') : t('settings.storage.addModal.import')}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
