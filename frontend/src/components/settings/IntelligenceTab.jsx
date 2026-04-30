'use client';

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Brain, Loader, Save, Eye, EyeOff, CheckCircle, ExternalLink,
} from 'lucide-react';
import {
  getIntelligenceConfig,
  setIntelligenceConfig,
  revealIntelligenceProvider,
} from '@/services/api';
import { useTranslation, useErrorToast } from '@/providers/I18nProvider';

const GEMINI_MODELS = [
  'gemini-3-flash-preview',
  'gemini-3.1-flash-lite-preview',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
];

export default function IntelligenceTab() {
  const { t } = useTranslation();
  const showError = useErrorToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [configured, setConfigured] = useState(false);
  const [maskedKey, setMaskedKey] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);

  const [apiKey, setApiKey] = useState('');
  const [apiKeyDirty, setApiKeyDirty] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState(GEMINI_MODELS[0]);

  async function refresh() {
    setLoading(true);
    try {
      const data = await getIntelligenceConfig();
      const gemini = data?.providers?.gemini || {};
      setConfigured(!!gemini.configured);
      setMaskedKey(gemini.masked || null);
      let rawKey = '';
      if (gemini.configured) {
        try {
          const revealed = await revealIntelligenceProvider('gemini');
          rawKey = typeof revealed?.api_key === 'string' ? revealed.api_key : '';
        } catch (err) {
          showError(err);
        }
      }
      const m = GEMINI_MODELS.includes(gemini.model) ? gemini.model : GEMINI_MODELS[0];
      setModel(m);
      setUpdatedAt(gemini.updated_at || null);
      setApiKey(rawKey);
      setApiKeyDirty(false);
      setShowKey(false);
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
      if (apiKeyDirty || trimmed) payload.gemini.api_key = trimmed;
      const data = await setIntelligenceConfig(payload);
      if (data?.detail_key) toast.success(t(data.detail_key));
      await refresh();
    } catch (err) {
      showError(err);
    } finally {
      setSaving(false);
    }
  }

  const hasNewKey = apiKey.trim().length > 0;
  const canSave = !saving && (hasNewKey || configured);

  return (
    <div className="flex flex-col gap-4">
      {loading ? (
        <div className="flex items-center justify-center py-10">
          <Loader className="w-5 h-5 text-muted-foreground animate-spin" />
        </div>
      ) : (
        <form
          onSubmit={handleSave}
          className="rounded-lg border border-border bg-card p-5 sm:p-6 flex flex-col gap-5"
        >
          <div
            className="flex items-center justify-between gap-2 pb-2 border-b"
            style={{ borderColor: 'hsl(var(--border))' }}
          >
            <div className="flex items-center gap-2">
              <Brain className="w-4 h-4 text-primary" />
              <h2 className="text-base font-semibold text-foreground">
                {t('settings.intelligence.gemini.title')}
              </h2>
            </div>
            {configured && (
              <span className="inline-flex items-center gap-1 text-xs text-success">
                <CheckCircle size={12} />
                {t('settings.intelligence.gemini.configuredBadge')}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {t('settings.intelligence.gemini.subtitle')}
          </p>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">
              {t('settings.intelligence.gemini.apiKeyLabel')}
            </label>
            <div className="flex items-stretch gap-1">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setApiKeyDirty(true);
                }}
                placeholder={configured && maskedKey ? maskedKey : 'AIza…'}
                disabled={saving}
                autoComplete="off"
                spellCheck={false}
                className="flex-1 px-3 py-2 rounded-md bg-input border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring font-mono"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                disabled={!apiKey || saving}
                className="px-3 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-40"
                title={showKey
                  ? t('settings.intelligence.gemini.hide')
                  : t('settings.intelligence.gemini.show')}
              >
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground">
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

          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">
              {t('settings.intelligence.gemini.modelLabel')}
            </label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={saving}
              className="w-full px-3 py-2 rounded-md bg-input border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring font-mono"
            >
              {GEMINI_MODELS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground">
              {t('settings.intelligence.gemini.modelHint')}
            </p>
          </div>

          {updatedAt && (
            <p className="text-[11px] text-muted-foreground">
              {t('settings.intelligence.gemini.updatedAt', {
                when: new Date(updatedAt).toLocaleString(),
              })}
            </p>
          )}

          <div className="flex flex-col sm:flex-row gap-2 pt-2 flex-wrap">
            <button
              type="submit"
              disabled={!canSave}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium text-white bg-brand-gradient hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {saving ? <Loader size={14} className="animate-spin" /> : <Save size={14} />}
              {saving ? t('settings.saving') : t('settings.intelligence.gemini.saveButton')}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
