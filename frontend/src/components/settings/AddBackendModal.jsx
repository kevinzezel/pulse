'use client';

import { useState } from 'react';
import { useTranslation, useErrorToast } from '@/providers/I18nProvider';
import { addBackend } from '@/services/api';

export default function AddBackendModal({ onClose, onAdded }) {
  const { t } = useTranslation();
  const showError = useErrorToast();
  const [busy, setBusy] = useState(false);
  const [driver, setDriver] = useState('s3');
  const [name, setName] = useState('');
  // S3 config fields
  const [endpoint, setEndpoint] = useState('');
  const [bucket, setBucket] = useState('');
  const [region, setRegion] = useState('us-east-1');
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const [prefix, setPrefix] = useState('');
  const [forcePathStyle, setForcePathStyle] = useState(false);
  // Mongo config fields
  const [uri, setUri] = useState('');
  const [database, setDatabase] = useState('pulse');

  async function handleSubmit(e) {
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
      onAdded();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-overlay/60 z-50 flex items-center justify-center p-4">
      <form onSubmit={handleSubmit} className="bg-card border border-border rounded-lg p-6 w-full max-w-md space-y-3 max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-semibold">{t('settings.storage.addModal.title')}</h3>

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
    </div>
  );
}
