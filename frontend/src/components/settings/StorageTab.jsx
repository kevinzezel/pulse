'use client';

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Database, Loader, Save, AlertTriangle, Upload, Download, Trash2, CheckCircle,
  Copy, HardDrive, Cloud, Eye, EyeOff,
} from 'lucide-react';
import {
  getStorageConfig, setStorageConfig, deleteStorageConfig,
  syncLocalToCloud, syncCloudToLocal,
} from '@/services/api';
import { useTranslation, useErrorToast } from '@/providers/I18nProvider';

const CONFIRM_WORD = 'sync';

const DRIVER_ORDER = ['file', 'mongo', 's3'];
const DRIVER_ICON = { file: HardDrive, mongo: Database, s3: Cloud };

function ConfirmDestructiveModal({ open, title, body, confirmLabel, onConfirm, onCancel, busy }) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (!open) setTyped('');
  }, [open]);

  if (!open) return null;

  const canConfirm = typed.trim().toLowerCase() === CONFIRM_WORD && !busy;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-overlay/60">
      <div className="bg-card border rounded-lg shadow-xl max-w-md w-full p-5" style={{ borderColor: 'hsl(var(--border))' }}>
        <div className="flex items-start gap-3 mb-3">
          <AlertTriangle className="w-5 h-5 text-destructive mt-0.5 shrink-0" />
          <h3 className="text-base font-semibold text-foreground">{title}</h3>
        </div>
        <div className="text-sm text-muted-foreground mb-4 whitespace-pre-line">{body}</div>
        <label className="block text-xs text-muted-foreground mb-1">
          {t('settings.storage.typeToConfirm', { word: CONFIRM_WORD })}
        </label>
        <input
          type="text"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          className="w-full px-2 py-1.5 text-sm rounded border bg-background text-foreground mb-4"
          style={{ borderColor: 'hsl(var(--input))' }}
          autoFocus
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-3 py-1.5 text-sm rounded border text-foreground hover:bg-accent disabled:opacity-50"
            style={{ borderColor: 'hsl(var(--border))' }}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canConfirm}
            className="px-3 py-1.5 text-sm rounded bg-destructive text-destructive-foreground disabled:opacity-50 inline-flex items-center gap-1.5 hover:opacity-90"
          >
            {busy && <Loader size={14} className="animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// Masked display of a secret with Reveal (eye) + Copy buttons. The reveal
// swaps the mask for the plaintext; Copy always copies plaintext regardless
// of reveal state. Mask is a constant width so a screenshot of the masked
// state doesn't leak the secret's length (addresses review M1).
const MASK_WIDTH = 12;

function MaskedValueWithCopy({ label, value, placeholder = '—' }) {
  const { t } = useTranslation();
  const [revealed, setRevealed] = useState(false);

  async function handleCopy() {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t('success.storage.copied'));
    } catch (err) {
      toast.error(t('errors.storage.clipboard_failed', { reason: err?.message || String(err) }));
    }
  }
  const displayed = value ? (revealed ? value : '•'.repeat(MASK_WIDTH)) : placeholder;
  return (
    <div className="flex items-center gap-2 text-xs">
      {label && <span className="text-muted-foreground w-28 shrink-0">{label}</span>}
      <code className="flex-1 font-mono text-foreground bg-accent/40 px-2 py-1 rounded truncate">{displayed}</code>
      <button
        type="button"
        onClick={() => setRevealed((v) => !v)}
        disabled={!value}
        className="inline-flex items-center gap-1 px-2 py-1 rounded border text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-40"
        style={{ borderColor: 'hsl(var(--border))' }}
        title={revealed ? t('settings.storage.hideButton') : t('settings.storage.showButton')}
      >
        {revealed ? <EyeOff size={12} /> : <Eye size={12} />}
      </button>
      <button
        type="button"
        onClick={handleCopy}
        disabled={!value}
        className="inline-flex items-center gap-1 px-2 py-1 rounded border text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-40"
        style={{ borderColor: 'hsl(var(--border))' }}
        title={t('settings.storage.copyButton')}
      >
        <Copy size={12} />
      </button>
    </div>
  );
}

// Password input with inline Reveal (eye) + Copy buttons.
function SecretInput({ value, onChange, placeholder, disabled }) {
  const { t } = useTranslation();
  const [revealed, setRevealed] = useState(false);

  async function handleCopy() {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t('success.storage.copied'));
    } catch (err) {
      toast.error(t('errors.storage.clipboard_failed', { reason: err?.message || String(err) }));
    }
  }
  return (
    <div className="relative">
      <input
        type={revealed ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-2 py-1.5 pr-16 text-sm rounded border bg-background text-foreground font-mono"
        style={{ borderColor: 'hsl(var(--input))' }}
        disabled={disabled}
      />
      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
        <button
          type="button"
          onClick={() => setRevealed((v) => !v)}
          disabled={!value}
          className="text-muted-foreground hover:text-foreground disabled:opacity-40"
          tabIndex={-1}
          title={revealed ? t('settings.storage.hideButton') : t('settings.storage.showButton')}
        >
          {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
        <button
          type="button"
          onClick={handleCopy}
          disabled={!value}
          className="text-muted-foreground hover:text-foreground disabled:opacity-40"
          tabIndex={-1}
          title={t('settings.storage.copyButton')}
        >
          <Copy size={14} />
        </button>
      </div>
    </div>
  );
}

export default function StorageTab() {
  const { t } = useTranslation();
  const showError = useErrorToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [syncingPush, setSyncingPush] = useState(false);
  const [syncingPull, setSyncingPull] = useState(false);

  const [activeDriver, setActiveDriver] = useState('file');
  const [activeConfig, setActiveConfig] = useState(null);

  const [selectedTab, setSelectedTab] = useState('file');

  // Per-driver form state
  const [mongoForm, setMongoForm] = useState({ uri: '', database: '' });
  const [s3Form, setS3Form] = useState({
    endpoint: '',
    bucket: '',
    region: '',
    access_key_id: '',
    secret_access_key: '',
    prefix: '',
    force_path_style: false,
  });

  const [confirmPush, setConfirmPush] = useState(false);
  const [confirmPull, setConfirmPull] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const data = await getStorageConfig();
      const driver = data.driver || 'file';
      setActiveDriver(driver);
      setActiveConfig(data.active_config || null);
      setSelectedTab(driver);
      // Prefill form with the active config so user sees current values.
      if (data.active_config) {
        if (driver === 'mongo') {
          setMongoForm({
            uri: data.active_config.uri || '',
            database: data.active_config.database || '',
          });
        } else if (driver === 's3') {
          setS3Form({
            endpoint: data.active_config.endpoint || '',
            bucket: data.active_config.bucket || '',
            region: data.active_config.region || '',
            access_key_id: data.active_config.access_key_id || '',
            secret_access_key: data.active_config.secret_access_key || '',
            prefix: data.active_config.prefix || '',
            force_path_style: data.active_config.force_path_style === true,
          });
        }
      }
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  function reloadPage() {
    if (typeof window !== 'undefined') window.location.reload();
  }

  async function handleActivateFile() {
    setDeleting(true);
    try {
      await deleteStorageConfig();
      toast.success(t('success.storage.file_activated'));
      reloadPage();
    } catch (err) {
      showError(err);
      setDeleting(false);
    }
  }

  async function handleActivateMongo(e) {
    e?.preventDefault?.();
    const uri = mongoForm.uri.trim();
    if (!uri) {
      toast.error(t('errors.mongo.uri_required'));
      return;
    }
    setSaving(true);
    try {
      await setStorageConfig({
        driver: 'mongo',
        uri,
        database: mongoForm.database.trim() || undefined,
      });
      toast.success(t('success.storage.config_activated'));
      reloadPage();
    } catch (err) {
      showError(err);
      setSaving(false);
    }
  }

  async function handleActivateS3(e) {
    e?.preventDefault?.();
    if (!s3Form.bucket.trim()) { toast.error(t('errors.s3.bucket_required')); return; }
    if (!s3Form.access_key_id.trim()) { toast.error(t('errors.s3.access_key_required')); return; }
    if (!s3Form.secret_access_key) { toast.error(t('errors.s3.secret_key_required')); return; }
    setSaving(true);
    try {
      await setStorageConfig({
        driver: 's3',
        endpoint: s3Form.endpoint.trim() || undefined,
        bucket: s3Form.bucket.trim(),
        region: s3Form.region.trim() || undefined,
        access_key_id: s3Form.access_key_id.trim(),
        secret_access_key: s3Form.secret_access_key,
        prefix: s3Form.prefix.trim() || undefined,
        force_path_style: !!s3Form.force_path_style,
      });
      toast.success(t('success.storage.config_activated'));
      reloadPage();
    } catch (err) {
      showError(err);
      setSaving(false);
    }
  }

  async function handleDeactivate() {
    setDeleting(true);
    try {
      await deleteStorageConfig();
      toast.success(t('success.storage.config_deactivated'));
      setConfirmDeactivate(false);
      reloadPage();
    } catch (err) {
      showError(err);
      setDeleting(false);
    }
  }

  async function handleSyncPush() {
    setSyncingPush(true);
    try {
      const data = await syncLocalToCloud();
      toast.success(t('success.storage.sync_local_to_cloud', { count: (data.synced || []).length }));
      setConfirmPush(false);
      reloadPage();
    } catch (err) {
      showError(err);
      setSyncingPush(false);
    }
  }

  async function handleSyncPull() {
    setSyncingPull(true);
    try {
      const data = await syncCloudToLocal();
      toast.success(t('success.storage.sync_cloud_to_local', { count: (data.synced || []).length }));
      setConfirmPull(false);
      reloadPage();
    } catch (err) {
      showError(err);
      setSyncingPull(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader size={16} className="animate-spin mr-2" />
        {t('common.loading')}
      </div>
    );
  }

  const activeDriverLabel = t(`settings.storage.drivers.${activeDriver}.statusLabel`);
  const tabActiveForSelected = selectedTab === activeDriver;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <Database className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">{t('settings.storage.title')}</h2>
        </div>
        <p className="text-sm text-muted-foreground">{t('settings.storage.subtitle')}</p>
      </header>

      <section className="rounded border p-4 space-y-2" style={{ borderColor: 'hsl(var(--border))' }}>
        <div className="flex items-center gap-2">
          <CheckCircle className="w-4 h-4 text-success" />
          <div className="text-sm font-medium text-foreground">
            {t('settings.storage.statusActive', { driver: activeDriverLabel })}
          </div>
        </div>
        {activeDriver === 'mongo' && activeConfig && (
          <MaskedValueWithCopy label={t('settings.storage.drivers.mongo.uriLabel')} value={activeConfig.uri} />
        )}
        {activeDriver === 's3' && activeConfig && (
          <>
            {activeConfig.endpoint && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground w-28 shrink-0">{t('settings.storage.drivers.s3.endpointLabel')}</span>
                <code className="flex-1 font-mono text-foreground bg-accent/40 px-2 py-1 rounded truncate">{activeConfig.endpoint}</code>
              </div>
            )}
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground w-28 shrink-0">{t('settings.storage.drivers.s3.bucketLabel')}</span>
              <code className="flex-1 font-mono text-foreground bg-accent/40 px-2 py-1 rounded truncate">{activeConfig.bucket}</code>
            </div>
            <MaskedValueWithCopy label={t('settings.storage.drivers.s3.accessKeyLabel')} value={activeConfig.access_key_id} />
            <MaskedValueWithCopy label={t('settings.storage.drivers.s3.secretKeyLabel')} value={activeConfig.secret_access_key} />
          </>
        )}
      </section>

      <div className="flex border-b" style={{ borderColor: 'hsl(var(--border))' }}>
        {DRIVER_ORDER.map((driver) => {
          const Icon = DRIVER_ICON[driver];
          const isSelected = selectedTab === driver;
          const isActive = activeDriver === driver;
          return (
            <button
              key={driver}
              onClick={() => setSelectedTab(driver)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                isSelected
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon size={14} />
              {t(`settings.storage.drivers.${driver}.label`)}
              {isActive && <span className="text-success">*</span>}
            </button>
          );
        })}
      </div>

      {selectedTab === 'file' && (
        <section className="rounded border p-4 space-y-3" style={{ borderColor: 'hsl(var(--border))' }}>
          <p className="text-sm text-muted-foreground">{t('settings.storage.drivers.file.description')}</p>
          {activeDriver === 'file' ? (
            <div className="text-xs text-success inline-flex items-center gap-1.5">
              <CheckCircle size={12} />
              {t('settings.storage.activeLabel')}
            </div>
          ) : (
            <button
              type="button"
              onClick={handleActivateFile}
              disabled={deleting}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded bg-primary text-primary-foreground disabled:opacity-50 hover:opacity-90"
            >
              {deleting ? <Loader size={14} className="animate-spin" /> : <Save size={14} />}
              {t('settings.storage.useLocalButton')}
            </button>
          )}
        </section>
      )}

      {selectedTab === 'mongo' && (
        <form onSubmit={handleActivateMongo} className="rounded border p-4 space-y-3" style={{ borderColor: 'hsl(var(--border))' }}>
          <p className="text-sm text-muted-foreground">{t('settings.storage.drivers.mongo.description')}</p>

          <div className="space-y-1">
            <label className="block text-xs text-muted-foreground">{t('settings.storage.drivers.mongo.uriLabel')}</label>
            <SecretInput
              value={mongoForm.uri}
              onChange={(v) => setMongoForm((s) => ({ ...s, uri: v }))}
              placeholder="mongodb://user:pass@host:27017"
              disabled={saving}
            />
            <p className="text-xs text-muted-foreground">{t('settings.storage.drivers.mongo.uriHint')}</p>
          </div>

          <div className="space-y-1">
            <label className="block text-xs text-muted-foreground">{t('settings.storage.drivers.mongo.databaseLabel')}</label>
            <input
              type="text"
              value={mongoForm.database}
              onChange={(e) => setMongoForm((s) => ({ ...s, database: e.target.value }))}
              placeholder="pulse"
              className="w-full px-2 py-1.5 text-sm rounded border bg-background text-foreground font-mono"
              style={{ borderColor: 'hsl(var(--input))' }}
              disabled={saving}
            />
            <p className="text-xs text-muted-foreground">{t('settings.storage.drivers.mongo.databaseHint')}</p>
          </div>

          <div className="flex items-center justify-end pt-1">
            <button
              type="submit"
              disabled={saving || !mongoForm.uri.trim()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded bg-primary text-primary-foreground disabled:opacity-50 hover:opacity-90"
            >
              {saving ? <Loader size={14} className="animate-spin" /> : <Save size={14} />}
              {t('settings.storage.validateActivateButton')}
            </button>
          </div>
        </form>
      )}

      {selectedTab === 's3' && (
        <form onSubmit={handleActivateS3} className="rounded border p-4 space-y-3" style={{ borderColor: 'hsl(var(--border))' }}>
          <p className="text-sm text-muted-foreground">{t('settings.storage.drivers.s3.description')}</p>

          <div className="space-y-1">
            <label className="block text-xs text-muted-foreground">{t('settings.storage.drivers.s3.endpointLabel')}</label>
            <input
              type="text"
              value={s3Form.endpoint}
              onChange={(e) => setS3Form((s) => ({ ...s, endpoint: e.target.value }))}
              placeholder="https://s3.amazonaws.com"
              className="w-full px-2 py-1.5 text-sm rounded border bg-background text-foreground font-mono"
              style={{ borderColor: 'hsl(var(--input))' }}
              disabled={saving}
            />
            <p className="text-xs text-muted-foreground">{t('settings.storage.drivers.s3.endpointHint')}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="block text-xs text-muted-foreground">{t('settings.storage.drivers.s3.bucketLabel')}</label>
              <input
                type="text"
                value={s3Form.bucket}
                onChange={(e) => setS3Form((s) => ({ ...s, bucket: e.target.value }))}
                placeholder="pulse-data"
                className="w-full px-2 py-1.5 text-sm rounded border bg-background text-foreground font-mono"
                style={{ borderColor: 'hsl(var(--input))' }}
                disabled={saving}
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs text-muted-foreground">{t('settings.storage.drivers.s3.regionLabel')}</label>
              <input
                type="text"
                value={s3Form.region}
                onChange={(e) => setS3Form((s) => ({ ...s, region: e.target.value }))}
                placeholder="us-east-1"
                className="w-full px-2 py-1.5 text-sm rounded border bg-background text-foreground font-mono"
                style={{ borderColor: 'hsl(var(--input))' }}
                disabled={saving}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t('settings.storage.drivers.s3.regionHint')}</p>

          <div className="space-y-1">
            <label className="block text-xs text-muted-foreground">{t('settings.storage.drivers.s3.accessKeyLabel')}</label>
            <SecretInput
              value={s3Form.access_key_id}
              onChange={(v) => setS3Form((s) => ({ ...s, access_key_id: v }))}
              placeholder="AKIA…"
              disabled={saving}
            />
          </div>

          <div className="space-y-1">
            <label className="block text-xs text-muted-foreground">{t('settings.storage.drivers.s3.secretKeyLabel')}</label>
            <SecretInput
              value={s3Form.secret_access_key}
              onChange={(v) => setS3Form((s) => ({ ...s, secret_access_key: v }))}
              placeholder=""
              disabled={saving}
            />
          </div>

          <div className="space-y-1">
            <label className="block text-xs text-muted-foreground">{t('settings.storage.drivers.s3.prefixLabel')}</label>
            <input
              type="text"
              value={s3Form.prefix}
              onChange={(e) => setS3Form((s) => ({ ...s, prefix: e.target.value }))}
              placeholder="pulse/"
              className="w-full px-2 py-1.5 text-sm rounded border bg-background text-foreground font-mono"
              style={{ borderColor: 'hsl(var(--input))' }}
              disabled={saving}
            />
            <p className="text-xs text-muted-foreground">{t('settings.storage.drivers.s3.prefixHint')}</p>
          </div>

          <label className="flex items-start gap-2 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={s3Form.force_path_style}
              onChange={(e) => setS3Form((s) => ({ ...s, force_path_style: e.target.checked }))}
              className="mt-0.5"
              disabled={saving}
            />
            <span>{t('settings.storage.drivers.s3.forcePathStyleLabel')}</span>
          </label>

          <div className="flex items-center justify-end pt-1">
            <button
              type="submit"
              disabled={saving || !s3Form.bucket.trim() || !s3Form.access_key_id.trim() || !s3Form.secret_access_key}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded bg-primary text-primary-foreground disabled:opacity-50 hover:opacity-90"
            >
              {saving ? <Loader size={14} className="animate-spin" /> : <Save size={14} />}
              {t('settings.storage.validateActivateButton')}
            </button>
          </div>
        </form>
      )}

      {tabActiveForSelected && activeDriver !== 'file' && (
        <section className="rounded border p-4 space-y-3" style={{ borderColor: 'hsl(var(--border))' }}>
          <h3 className="text-sm font-semibold text-foreground">{t('settings.storage.syncTitle')}</h3>
          <p className="text-xs text-muted-foreground">{t('settings.storage.syncSubtitle')}</p>

          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => setConfirmPush(true)}
              disabled={syncingPush}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded border text-foreground hover:bg-accent disabled:opacity-50"
              style={{ borderColor: 'hsl(var(--border))' }}
            >
              <Upload size={14} />
              {t('settings.storage.syncLocalToCloudButton')}
            </button>
            <button
              type="button"
              onClick={() => setConfirmPull(true)}
              disabled={syncingPull}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded border text-foreground hover:bg-accent disabled:opacity-50"
              style={{ borderColor: 'hsl(var(--border))' }}
            >
              <Download size={14} />
              {t('settings.storage.syncCloudToLocalButton')}
            </button>
            <button
              type="button"
              onClick={() => setConfirmDeactivate(true)}
              disabled={deleting}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded border text-destructive hover:bg-destructive/10 disabled:opacity-50"
              style={{ borderColor: 'hsl(var(--border))' }}
            >
              <Trash2 size={14} />
              {t('settings.storage.deactivateButton')}
            </button>
          </div>
        </section>
      )}

      <ConfirmDestructiveModal
        open={confirmPush}
        busy={syncingPush}
        title={t('settings.storage.confirmPush.title')}
        body={t('settings.storage.confirmPush.body')}
        confirmLabel={t('settings.storage.confirmPush.confirm')}
        onConfirm={handleSyncPush}
        onCancel={() => setConfirmPush(false)}
      />
      <ConfirmDestructiveModal
        open={confirmPull}
        busy={syncingPull}
        title={t('settings.storage.confirmPull.title')}
        body={t('settings.storage.confirmPull.body')}
        confirmLabel={t('settings.storage.confirmPull.confirm')}
        onConfirm={handleSyncPull}
        onCancel={() => setConfirmPull(false)}
      />
      <ConfirmDestructiveModal
        open={confirmDeactivate}
        busy={deleting}
        title={t('settings.storage.confirmDeactivate.title')}
        body={t('settings.storage.confirmDeactivate.body')}
        confirmLabel={t('settings.storage.confirmDeactivate.confirm')}
        onConfirm={handleDeactivate}
        onCancel={() => setConfirmDeactivate(false)}
      />
    </div>
  );
}
