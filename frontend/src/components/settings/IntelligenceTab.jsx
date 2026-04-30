'use client';

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Brain, Loader, Save, Trash2, Eye, EyeOff, CheckCircle, AlertTriangle, ExternalLink, Copy, Check } from 'lucide-react';
import {
  getIntelligenceConfig,
  setIntelligenceConfig,
  deleteIntelligenceConfig,
  revealIntelligenceProvider,
} from '@/services/api';
import { useTranslation, useErrorToast } from '@/providers/I18nProvider';

const GEMINI_MODELS = [
  'gemini-3-flash-preview',
  'gemini-3.1-flash-lite-preview',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
];

function SecretInput({ value, onChange, placeholder, disabled }) {
  const { t } = useTranslation();
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="relative">
      <input
        type={revealed ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-2 py-1.5 pr-9 text-sm rounded border bg-background text-foreground font-mono"
        style={{ borderColor: 'hsl(var(--input))' }}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
      />
      <button
        type="button"
        onClick={() => setRevealed((v) => !v)}
        disabled={!value}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground disabled:opacity-40"
        tabIndex={-1}
        title={revealed ? t('settings.intelligence.gemini.hide') : t('settings.intelligence.gemini.show')}
      >
        {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  );
}

function ConfirmClearModal({ open, busy, onConfirm, onCancel }) {
  const { t } = useTranslation();
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-overlay/60">
      <div
        className="bg-card border rounded-lg shadow-xl max-w-md w-full p-5"
        style={{ borderColor: 'hsl(var(--border))' }}
      >
        <div className="flex items-start gap-3 mb-3">
          <AlertTriangle className="w-5 h-5 text-destructive mt-0.5 shrink-0" />
          <h3 className="text-base font-semibold text-foreground">
            {t('settings.intelligence.gemini.clearConfirm.title')}
          </h3>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          {t('settings.intelligence.gemini.clearConfirm.body')}
        </p>
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
            disabled={busy}
            className="px-3 py-1.5 text-sm rounded bg-destructive text-destructive-foreground disabled:opacity-50 inline-flex items-center gap-1.5 hover:opacity-90"
          >
            {busy ? <Loader size={14} className="animate-spin" /> : <Trash2 size={14} />}
            {t('settings.intelligence.gemini.clearConfirm.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function IntelligenceTab() {
  const { t } = useTranslation();
  const showError = useErrorToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const [configured, setConfigured] = useState(false);
  const [maskedKey, setMaskedKey] = useState(null);
  const [savedModel, setSavedModel] = useState(GEMINI_MODELS[0]);
  const [updatedAt, setUpdatedAt] = useState(null);

  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(GEMINI_MODELS[0]);

  async function refresh() {
    setLoading(true);
    try {
      const data = await getIntelligenceConfig();
      const gemini = data?.providers?.gemini || {};
      setConfigured(!!gemini.configured);
      setMaskedKey(gemini.masked || null);
      const m = GEMINI_MODELS.includes(gemini.model) ? gemini.model : GEMINI_MODELS[0];
      setSavedModel(m);
      setModel(m);
      setUpdatedAt(gemini.updated_at || null);
      setApiKey('');
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  async function handleSave(e) {
    e?.preventDefault?.();
    const trimmed = apiKey.trim();
    if (!trimmed && !configured) {
      toast.error(t('errors.intelligence.gemini.api_key_required'));
      return;
    }
    setSaving(true);
    try {
      const payload = { gemini: { model } };
      if (trimmed) payload.gemini.api_key = trimmed;
      const data = await setIntelligenceConfig(payload);
      if (data?.detail_key) toast.success(t(data.detail_key));
      await refresh();
    } catch (err) {
      showError(err);
    } finally {
      setSaving(false);
    }
  }

  async function handleCopy() {
    setCopying(true);
    try {
      // Server returns 404 with detail_key 'errors.intelligence.gemini.not_configured'
      // when the key is missing — that path goes straight to the outer catch.
      const data = await revealIntelligenceProvider('gemini');
      try {
        await navigator.clipboard.writeText(data.api_key);
      } catch {
        showError({ detail_key: 'errors.intelligence.gemini.copy_failed' });
        return;
      }
      setCopied(true);
      toast.success(t('success.intelligence.gemini_copied'));
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      showError(err);
    } finally {
      setCopying(false);
    }
  }

  async function handleClear() {
    setClearing(true);
    try {
      const data = await deleteIntelligenceConfig('gemini');
      if (data?.detail_key) toast.success(t(data.detail_key));
      setConfirmClear(false);
      await refresh();
    } catch (err) {
      showError(err);
    } finally {
      setClearing(false);
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

  const modelChanged = model !== savedModel;
  const hasNewKey = apiKey.trim().length > 0;
  const canSave = !saving && (hasNewKey || (configured && modelChanged));

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">{t('settings.intelligence.title')}</h2>
        </div>
        <p className="text-sm text-muted-foreground">{t('settings.intelligence.subtitle')}</p>
      </header>

      <form
        onSubmit={handleSave}
        className="rounded border p-4 space-y-3"
        style={{ borderColor: 'hsl(var(--border))' }}
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              {t('settings.intelligence.gemini.title')}
            </h3>
            <p className="text-xs text-muted-foreground">
              {t('settings.intelligence.gemini.subtitle')}
            </p>
          </div>
          {configured && (
            <span className="inline-flex items-center gap-1 text-xs text-success">
              <CheckCircle size={12} />
              {t('settings.intelligence.gemini.configuredBadge')}
            </span>
          )}
        </div>

        <div className="space-y-1">
          <label className="block text-xs text-muted-foreground">
            {t('settings.intelligence.gemini.apiKeyLabel')}
          </label>
          <SecretInput
            value={apiKey}
            onChange={setApiKey}
            placeholder={configured && maskedKey ? maskedKey : 'AIza…'}
            disabled={saving}
          />
          <p className="text-xs text-muted-foreground">
            {configured
              ? t('settings.intelligence.gemini.apiKeyHintConfigured')
              : t('settings.intelligence.gemini.apiKeyHintEmpty')}
            {' '}
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline inline-flex items-center gap-0.5"
            >
              {t('settings.intelligence.gemini.getKeyLink')}
              <ExternalLink size={10} />
            </a>
          </p>
        </div>

        <div className="space-y-1">
          <label className="block text-xs text-muted-foreground">
            {t('settings.intelligence.gemini.modelLabel')}
          </label>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={saving}
            className="w-full px-2 py-1.5 text-sm rounded border bg-background text-foreground font-mono"
            style={{ borderColor: 'hsl(var(--input))' }}
          >
            {GEMINI_MODELS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            {t('settings.intelligence.gemini.modelHint')}
          </p>
        </div>

        {updatedAt && (
          <p className="text-xs text-muted-foreground">
            {t('settings.intelligence.gemini.updatedAt', {
              when: new Date(updatedAt).toLocaleString(),
            })}
          </p>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          {configured && (
            <button
              type="button"
              onClick={handleCopy}
              disabled={copying || saving || clearing}
              title={t('settings.intelligence.gemini.copyTooltip')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded border text-foreground hover:bg-accent disabled:opacity-50"
              style={{ borderColor: 'hsl(var(--border))' }}
            >
              {copying
                ? <Loader size={14} className="animate-spin" />
                : copied
                ? <Check size={14} className="text-success" />
                : <Copy size={14} />}
              {t('settings.intelligence.gemini.copyButton')}
            </button>
          )}
          {configured && (
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              disabled={clearing || saving || copying}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded border text-destructive hover:bg-destructive/10 disabled:opacity-50"
              style={{ borderColor: 'hsl(var(--border))' }}
            >
              <Trash2 size={14} />
              {t('settings.intelligence.gemini.clearButton')}
            </button>
          )}
          <button
            type="submit"
            disabled={!canSave || copying}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded bg-primary text-primary-foreground disabled:opacity-50 hover:opacity-90"
          >
            {saving ? <Loader size={14} className="animate-spin" /> : <Save size={14} />}
            {t('settings.intelligence.gemini.saveButton')}
          </button>
        </div>
      </form>

      <ConfirmClearModal
        open={confirmClear}
        busy={clearing}
        onConfirm={handleClear}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  );
}
