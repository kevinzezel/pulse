'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation, useErrorToast } from '@/providers/I18nProvider';
import { addBackend, updateBackend, importBackendToken } from '@/services/api';

// Single modal that handles three flows for managing storage backends:
//
// 1. Form-add   — fill in driver-specific credentials manually.
// 2. Form-edit  — patch an existing backend's name/config; secret fields
//                 prefill with the masked value and only get sent to the
//                 server when the user changes them. The driver and storage
//                 token import are not editable here.
// 3. Token mode — paste a `pulsebackend://v1/...` share token; the server
//                 decodes it, pings the backend, and registers it locally.
//                 Token mode is only offered when adding (no editing).
export default function AddBackendModal({ onClose, onAdded, backend = null }) {
  const { t } = useTranslation();
  const showError = useErrorToast();
  const isEdit = backend != null;
  const [mode, setMode] = useState('form'); // 'form' | 'token'
  const [busy, setBusy] = useState(false);
  // Portal target. Some ancestor in the settings tree creates a stacking
  // trap (transform/filter on a layout container), which makes a child
  // `fixed inset-0` overlay start at the container's top instead of the
  // viewport's. Rendering through document.body sidesteps the trap entirely.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // v5.0 dropped MongoDB; only s3 remains as a configurable remote driver.
  const initialConfig = backend?.config || {};
  const driver = 's3';

  // Form-mode state
  const [name, setName] = useState(backend?.name || '');
  const [endpoint, setEndpoint] = useState(initialConfig.endpoint || '');
  const [bucket, setBucket] = useState(initialConfig.bucket || '');
  const [region, setRegion] = useState(initialConfig.region || 'us-east-1');
  const [accessKeyId, setAccessKeyId] = useState(initialConfig.access_key_id || '');
  const [secretAccessKey, setSecretAccessKey] = useState(initialConfig.secret_access_key || '');
  const [prefix, setPrefix] = useState(initialConfig.prefix || '');
  const [forcePathStyle, setForcePathStyle] = useState(!!initialConfig.force_path_style);

  // Token-mode state
  const [token, setToken] = useState('');
  const [rename, setRename] = useState('');

  async function handleSubmitForm(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const config = {
        endpoint: endpoint || undefined,
        bucket,
        region,
        access_key_id: accessKeyId,
        secret_access_key: secretAccessKey,
        prefix,
        force_path_style: forcePathStyle,
      };
      if (isEdit) {
        await updateBackend(backend.id, { name, config });
        toast.success(t('settings.storage.addModal.successUpdated', { name }));
      } else {
        await addBackend({ name, driver, config });
        toast.success(t('settings.storage.addModal.successAdded', { name }));
      }
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

  const title = isEdit
    ? t('settings.storage.addModal.editTitle')
    : t('settings.storage.addModal.title');
  const submitLabelIdle = isEdit
    ? t('settings.storage.addModal.save')
    : t('settings.storage.addModal.validate');
  const submitLabelBusy = isEdit
    ? t('settings.storage.addModal.saving')
    : t('settings.storage.addModal.validating');

  if (!mounted) return null;

  return createPortal((
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-overlay/60 px-4">
      <div className="bg-card border border-border rounded-lg p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-foreground font-semibold">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            aria-label={t('settings.storage.addModal.cancel')}
          >
            <X size={18} />
          </button>
        </div>

        {!isEdit && (
          <div className="flex gap-1 p-1 bg-muted/40 rounded-md text-xs mb-4">
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
        )}

        {(isEdit || mode === 'form') && (
          <form onSubmit={handleSubmitForm} className="space-y-3">
            <div>
              <label className="block text-sm text-muted-foreground mb-1">
                {t('settings.storage.addModal.name')}
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            <div>
              <label className="block text-sm text-muted-foreground mb-1">
                {t('settings.storage.addModal.driver')}
              </label>
              <div className="w-full px-3 py-2 bg-muted/30 border border-border rounded-md text-foreground text-sm">
                {t('settings.storage.addModal.driverS3')}
              </div>
            </div>

                <div>
                  <label className="block text-sm text-muted-foreground mb-1">
                    {t('settings.storage.addModal.endpoint')}
                  </label>
                  <input
                    value={endpoint}
                    onChange={(e) => setEndpoint(e.target.value)}
                    placeholder="https://s3.amazonaws.com"
                    className="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
                <div>
                  <label className="block text-sm text-muted-foreground mb-1">
                    {t('settings.storage.addModal.bucket')}
                  </label>
                  <input
                    value={bucket}
                    onChange={(e) => setBucket(e.target.value)}
                    required
                    className="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
                <div>
                  <label className="block text-sm text-muted-foreground mb-1">
                    {t('settings.storage.addModal.region')}
                  </label>
                  <input
                    value={region}
                    onChange={(e) => setRegion(e.target.value)}
                    className="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
                <div>
                  <label className="block text-sm text-muted-foreground mb-1">
                    {t('settings.storage.addModal.accessKeyId')}
                  </label>
                  <input
                    value={accessKeyId}
                    onChange={(e) => setAccessKeyId(e.target.value)}
                    required={!isEdit}
                    placeholder={isEdit ? t('settings.storage.addModal.secretPlaceholder') : ''}
                    className="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
                <div>
                  <label className="block text-sm text-muted-foreground mb-1">
                    {t('settings.storage.addModal.secretAccessKey')}
                  </label>
                  <input
                    type="password"
                    value={secretAccessKey}
                    onChange={(e) => setSecretAccessKey(e.target.value)}
                    required={!isEdit}
                    placeholder={isEdit ? t('settings.storage.addModal.secretPlaceholder') : ''}
                    className="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
                <div>
                  <label className="block text-sm text-muted-foreground mb-1">
                    {t('settings.storage.addModal.prefix')}
                  </label>
                  <input
                    value={prefix}
                    onChange={(e) => setPrefix(e.target.value)}
                    className="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={forcePathStyle}
                    onChange={(e) => setForcePathStyle(e.target.checked)}
                  />
                  {t('settings.storage.addModal.forcePathStyle')}
                </label>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="px-3 py-2 text-sm rounded-md border border-border text-foreground hover:bg-accent disabled:opacity-50"
              >
                {t('settings.storage.addModal.cancel')}
              </button>
              <button
                type="submit"
                disabled={busy}
                className="flex-1 py-2 rounded-md text-sm font-medium text-white bg-brand-gradient hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
              >
                {busy ? submitLabelBusy : submitLabelIdle}
              </button>
            </div>
          </form>
        )}

        {!isEdit && mode === 'token' && (
          <form onSubmit={handleSubmitToken} className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {t('settings.storage.addModal.tokenHelp')}
            </p>
            <div>
              <label className="block text-sm text-muted-foreground mb-1">
                {t('settings.storage.addModal.tokenLabel')}
              </label>
              <textarea
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={t('settings.storage.addModal.tokenPlaceholder')}
                rows={5}
                required
                className="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground font-mono text-xs break-all focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1">
                {t('settings.storage.addModal.tokenRenameLabel')}
              </label>
              <input
                value={rename}
                onChange={(e) => setRename(e.target.value)}
                placeholder={t('settings.storage.addModal.tokenRenamePlaceholder')}
                className="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="px-3 py-2 text-sm rounded-md border border-border text-foreground hover:bg-accent disabled:opacity-50"
              >
                {t('settings.storage.addModal.cancel')}
              </button>
              <button
                type="submit"
                disabled={busy || !token.trim()}
                className="flex-1 py-2 rounded-md text-sm font-medium text-white bg-brand-gradient hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
              >
                {busy ? t('settings.storage.addModal.importing') : t('settings.storage.addModal.import')}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  ), document.body);
}
