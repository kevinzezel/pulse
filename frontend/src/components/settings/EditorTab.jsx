'use client';

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Check, Loader, Wand2, Folder } from 'lucide-react';
import {
  getSettings, updateEditorSettings, resolveEditor,
} from '@/services/api';
import { useTranslation, useErrorToast } from '@/providers/I18nProvider';
import { useServers } from '@/providers/ServersProvider';
import ServerSelector from './ServerSelector';

export default function EditorTab() {
  const { t } = useTranslation();
  const showError = useErrorToast();
  const { servers } = useServers();

  const [serverId, setServerId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [detecting, setDetecting] = useState(false);

  const [binaryOverride, setBinaryOverride] = useState('');
  const [autoDetected, setAutoDetected] = useState(null);

  useEffect(() => {
    if (!serverId && servers.length > 0) setServerId(servers[0].id);
  }, [servers, serverId]);

  useEffect(() => {
    if (!serverId) return;
    let cancelled = false;
    setLoading(true);
    getSettings(serverId)
      .then(data => {
        if (cancelled) return;
        setBinaryOverride(data.settings?.editor?.binary_override || '');
      })
      .catch(showError)
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [serverId, showError]);

  async function handleSave(e) {
    e.preventDefault();
    if (!serverId) return;
    setSaving(true);
    try {
      const data = await updateEditorSettings(serverId, { binaryOverride });
      toast.success(data.detail);
    } catch (err) {
      showError(err);
    } finally {
      setSaving(false);
    }
  }

  async function handleDetect() {
    if (!serverId) return;
    setDetecting(true);
    try {
      const data = await resolveEditor(serverId);
      setAutoDetected(data);
      toast.success(t('settings.editor.detected', { path: data.resolved }));
    } catch (err) {
      setAutoDetected(null);
      showError(err);
    } finally {
      setDetecting(false);
    }
  }

  function handleUseDetected() {
    if (autoDetected?.resolved) {
      setBinaryOverride(autoDetected.resolved);
    }
  }

  function handleClearOverride() {
    setBinaryOverride('');
  }

  if (servers.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
        {t('settings.selectServerHint')}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ServerSelector
        servers={servers}
        value={serverId}
        onChange={setServerId}
        disabled={loading || saving}
      />

      {loading ? (
        <div className="flex items-center justify-center py-10">
          <Loader className="w-5 h-5 text-muted-foreground animate-spin" />
        </div>
      ) : (
        <form
          onSubmit={handleSave}
          className="rounded-lg border border-border bg-card p-5 sm:p-6 flex flex-col gap-5"
        >
          <div className="flex items-center gap-2 pb-2 border-b" style={{ borderColor: 'hsl(var(--border))' }}>
            <Folder className="w-4 h-4 text-primary" />
            <h2 className="text-base font-semibold text-foreground">{t('settings.editor.title')}</h2>
          </div>
          <p className="text-xs text-muted-foreground">{t('settings.editor.subtitle')}</p>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">{t('settings.editor.pathLabel')}</label>
            <div className="flex items-stretch gap-1">
              <input
                type="text"
                value={binaryOverride}
                onChange={(e) => setBinaryOverride(e.target.value)}
                placeholder={t('settings.editor.pathPlaceholder')}
                disabled={saving}
                autoComplete="off"
                spellCheck={false}
                className="flex-1 px-3 py-2 rounded-md bg-input border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring font-mono"
              />
              <button
                type="button"
                onClick={handleClearOverride}
                disabled={!binaryOverride || saving}
                className="px-3 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-50"
                title={t('settings.editor.clearOverride')}
              >
                {t('settings.editor.clear')}
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground">{t('settings.editor.pathHint')}</p>
          </div>

          {autoDetected && (
            <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
              <div className="flex items-center justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-foreground">{t('settings.editor.detectedTitle')}</div>
                  <div className="font-mono text-[11px] truncate">{autoDetected.resolved}</div>
                  <div className="text-[11px] mt-0.5">
                    {t(`settings.editor.source.${autoDetected.source}`)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleUseDetected}
                  className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border text-foreground hover:bg-muted/40 transition-colors text-xs"
                >
                  {t('settings.editor.useDetected')}
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-2 pt-2 flex-wrap">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium text-white bg-brand-gradient hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {saving ? <Loader size={14} className="animate-spin" /> : <Check size={14} />}
              {saving ? t('settings.saving') : t('settings.save')}
            </button>
            <button
              type="button"
              onClick={handleDetect}
              disabled={detecting || saving}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium border border-border text-foreground hover:bg-muted/40 transition-colors disabled:opacity-50"
            >
              {detecting ? <Loader size={14} className="animate-spin" /> : <Wand2 size={14} />}
              {detecting ? t('settings.editor.detecting') : t('settings.editor.autoDetect')}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
