'use client';

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Bell, Check, Loader, Send, Eye, EyeOff, Wand2, Copy } from 'lucide-react';
import {
  getSettings, updateTelegramSettings, testTelegram, discoverChatId,
} from '@/services/api';
import { useTranslation, useErrorToast } from '@/providers/I18nProvider';
import { useServers } from '@/providers/ServersProvider';
import ServerSelector from './ServerSelector';

export default function TelegramTab() {
  const { t } = useTranslation();
  const showError = useErrorToast();
  const { servers } = useServers();

  const [serverId, setServerId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [replicating, setReplicating] = useState(false);

  const [botToken, setBotToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [chatId, setChatId] = useState('');

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
        setBotToken(data.settings?.telegram?.bot_token || '');
        setChatId(data.settings?.telegram?.chat_id || '');
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
      const data = await updateTelegramSettings(serverId, { botToken, chatId });
      toast.success(data.detail);
    } catch (err) {
      showError(err);
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    if (!serverId) return;
    setTesting(true);
    try {
      const data = await testTelegram(serverId);
      toast.success(data.detail);
    } catch (err) {
      showError(err);
    } finally {
      setTesting(false);
    }
  }

  async function handleDiscover() {
    if (!serverId) return;
    setDiscovering(true);
    try {
      const data = await discoverChatId(serverId, botToken);
      setChatId(data.chat_id);
      toast.success(data.detail);
    } catch (err) {
      showError(err);
    } finally {
      setDiscovering(false);
    }
  }

  async function handleReplicate() {
    if (servers.length <= 1) return;
    setReplicating(true);
    const payload = { botToken, chatId };
    const results = await Promise.allSettled(
      servers.map(s => updateTelegramSettings(s.id, payload))
    );
    const failed = results
      .map((r, i) => r.status === 'rejected' ? servers[i] : null)
      .filter(Boolean);
    if (failed.length) {
      toast.error(t('settings.replicate.partial', {
        names: failed.map(s => s.name || `${s.host}:${s.port}`).join(', '),
      }));
    } else {
      toast.success(t('settings.replicate.all'));
    }
    setReplicating(false);
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
            <Bell className="w-4 h-4 text-primary" />
            <h2 className="text-base font-semibold text-foreground">{t('settings.notifications.title')}</h2>
          </div>
          <p className="text-xs text-muted-foreground">{t('settings.notifications.subtitle')}</p>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">{t('settings.notifications.botTokenLabel')}</label>
            <div className="flex items-stretch gap-1">
              <input
                type={showToken ? 'text' : 'password'}
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
                placeholder={t('settings.notifications.botTokenPlaceholder')}
                disabled={saving}
                autoComplete="off"
                className="flex-1 px-3 py-2 rounded-md bg-input border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring font-mono"
              />
              <button
                type="button"
                onClick={() => setShowToken(v => !v)}
                className="px-3 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                title={showToken ? t('settings.notifications.hideToken') : t('settings.notifications.showToken')}
              >
                {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground">{t('settings.notifications.botTokenHint')}</p>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">{t('settings.notifications.chatIdLabel')}</label>
            <div className="flex items-stretch gap-1">
              <input
                type="text"
                value={chatId}
                onChange={(e) => setChatId(e.target.value)}
                placeholder={t('settings.notifications.chatIdPlaceholder')}
                disabled={saving}
                autoComplete="off"
                className="flex-1 px-3 py-2 rounded-md bg-input border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring font-mono"
              />
              <button
                type="button"
                onClick={handleDiscover}
                disabled={discovering || saving || !botToken.trim()}
                className="inline-flex items-center gap-1 px-3 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-50"
                title={!botToken.trim() ? t('settings.notifications.configureFirst') : t('settings.notifications.detectChatId')}
              >
                {discovering ? <Loader size={14} className="animate-spin" /> : <Wand2 size={14} />}
                <span className="hidden sm:inline text-xs">{t('settings.notifications.detect')}</span>
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground">{t('settings.notifications.chatIdHint')}</p>
          </div>

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
              onClick={handleTest}
              disabled={testing || saving || !botToken.trim() || !chatId.trim()}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium border border-border text-foreground hover:bg-muted/40 transition-colors disabled:opacity-50"
              title={(!botToken.trim() || !chatId.trim()) ? t('settings.notifications.configureFirst') : undefined}
            >
              {testing ? <Loader size={14} className="animate-spin" /> : <Send size={14} />}
              {testing ? t('settings.testing') : t('settings.test')}
            </button>
            {servers.length > 1 && (
              <button
                type="button"
                onClick={handleReplicate}
                disabled={replicating || saving}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium border border-border text-foreground hover:bg-muted/40 transition-colors disabled:opacity-50"
                title={t('settings.replicate.button')}
              >
                {replicating ? <Loader size={14} className="animate-spin" /> : <Copy size={14} />}
                {t('settings.replicate.button')}
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
