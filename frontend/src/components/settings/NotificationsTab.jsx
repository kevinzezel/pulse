'use client';

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Bell, Check, Loader, Copy, Monitor, Volume2, VolumeX, Send, AlertTriangle } from 'lucide-react';
import { getSettings, updateNotificationsSettings } from '@/services/api';
import { useTranslation, useErrorToast } from '@/providers/I18nProvider';
import { useServers } from '@/providers/ServersProvider';
import { useNotifications } from '@/providers/NotificationsProvider';
import ServerSelector from './ServerSelector';

function clampTimeout(v) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return 30;
  return Math.max(15, Math.min(3600, n));
}

function Toggle({ checked, onChange, disabled, label, icon }) {
  return (
    <label className={`inline-flex items-center gap-2.5 select-none ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => !disabled && onChange(!checked)}
        disabled={disabled}
        className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          checked ? 'bg-primary' : 'bg-muted'
        } ${disabled ? 'pointer-events-none' : ''}`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-[19px]' : 'translate-x-[3px]'
          }`}
        />
      </button>
      <span className="inline-flex items-center gap-1.5 text-sm text-foreground">
        {icon}
        {label}
      </span>
    </label>
  );
}

export default function NotificationsTab() {
  const { t } = useTranslation();
  const showError = useErrorToast();
  const { servers } = useServers();
  const { supported: notifySupported, permission: notifyPermission, permissionReason: notifyPermissionReason, requestBrowserPermission, muted, setMuted } = useNotifications();
  const insecureOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  const insecurePort = typeof window !== 'undefined' ? window.location.port : '';

  const [serverId, setServerId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [replicating, setReplicating] = useState(false);
  const [requestingPermission, setRequestingPermission] = useState(false);
  const [timeoutSecs, setTimeoutSecs] = useState(30);
  const [channelBrowser, setChannelBrowser] = useState(true);
  const [channelTelegram, setChannelTelegram] = useState(true);
  const [telegramConfigured, setTelegramConfigured] = useState(false);

  async function handleRequestPermission() {
    setRequestingPermission(true);
    try {
      const result = await requestBrowserPermission();
      if (result === 'granted') {
        toast.success(t('notifications.permissionGrantedToast'));
      } else if (result === 'denied') {
        if (notifyPermissionReason === 'insecure-context') {
          toast.error(t('notifications.insecureContextToast', { origin: insecureOrigin }), { duration: 7000 });
        } else {
          toast.error(t('notifications.permissionDeniedToast'));
        }
      }
    } finally {
      setRequestingPermission(false);
    }
  }

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
        const notif = data.settings?.notifications || {};
        const tele = data.settings?.telegram || {};
        setTimeoutSecs(notif.idle_timeout_seconds || 30);
        const channels = Array.isArray(notif.channels) ? notif.channels : ['browser', 'telegram'];
        setChannelBrowser(channels.includes('browser'));
        setChannelTelegram(channels.includes('telegram'));
        setTelegramConfigured(Boolean(tele.bot_token && tele.chat_id));
      })
      .catch(showError)
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [serverId, showError]);

  function buildChannels() {
    const list = [];
    if (channelBrowser) list.push('browser');
    if (channelTelegram) list.push('telegram');
    return list;
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!serverId) return;
    setSaving(true);
    const n = clampTimeout(timeoutSecs);
    try {
      const data = await updateNotificationsSettings(serverId, {
        idleTimeoutSeconds: n,
        channels: buildChannels(),
      });
      setTimeoutSecs(n);
      toast.success(data.detail);
    } catch (err) {
      showError(err);
    } finally {
      setSaving(false);
    }
  }

  async function handleReplicate() {
    if (servers.length <= 1) return;
    setReplicating(true);
    const n = clampTimeout(timeoutSecs);
    const channels = buildChannels();
    const results = await Promise.allSettled(
      servers.map(s => updateNotificationsSettings(s.id, { idleTimeoutSeconds: n, channels }))
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

  const browserCard = (
    <div className="rounded-lg border border-border bg-card p-5 sm:p-6 flex flex-col gap-4">
      <div className="flex items-center gap-2 pb-2 border-b" style={{ borderColor: 'hsl(var(--border))' }}>
        <Monitor className="w-4 h-4 text-primary" />
        <h2 className="text-base font-semibold text-foreground">{t('notifications.browserSection')}</h2>
      </div>
      <p className="text-xs text-muted-foreground">{t('notifications.browserSectionHint')}</p>

      {notifyPermissionReason === 'insecure-context' && (
        <div className="flex items-start gap-2 rounded-md px-3 py-2.5 text-xs border" style={{ background: 'hsl(var(--destructive) / 0.08)', borderColor: 'hsl(var(--destructive) / 0.35)' }}>
          <AlertTriangle size={14} className="text-destructive flex-shrink-0 mt-0.5" />
          <div className="flex flex-col gap-1.5 min-w-0">
            <span className="font-semibold text-destructive">{t('notifications.insecureContextBannerTitle')}</span>
            <span className="text-muted-foreground leading-relaxed">
              {t('notifications.insecureContextBannerBody', { origin: insecureOrigin, port: insecurePort || '3000' })}
            </span>
            <a
              href="https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline w-fit"
            >
              {t('notifications.insecureContextLearnMore')} ↗
            </a>
          </div>
        </div>
      )}

      {!notifySupported ? (
        <p className="text-xs text-destructive">{t('notifications.unsupported')}</p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            {notifyPermission === 'granted' && (
              <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md text-success" style={{ background: 'hsl(var(--success) / 0.12)' }}>
                <Check size={12} /> {t('notifications.permissionGranted')}
              </span>
            )}
            {notifyPermission === 'denied' && (
              <span className="text-xs text-destructive">{t('notifications.permissionDenied')}</span>
            )}
            {notifyPermission === 'default' && (
              <>
                <span className="text-xs text-muted-foreground">{t('notifications.permissionDefault')}</span>
                <button
                  type="button"
                  onClick={handleRequestPermission}
                  disabled={requestingPermission}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border border-border text-foreground hover:bg-muted/40 transition-colors disabled:opacity-50"
                >
                  {requestingPermission ? <Loader size={12} className="animate-spin" /> : <Bell size={12} />}
                  {requestingPermission ? t('notifications.requestingPermission') : t('notifications.requestPermission')}
                </button>
              </>
            )}
          </div>

          <Toggle
            checked={muted}
            onChange={setMuted}
            label={t('notifications.muteSound')}
            icon={muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
          />
          <p className="text-[11px] text-muted-foreground -mt-1 pl-[46px]">{t('notifications.muteSoundHint')}</p>
        </div>
      )}
    </div>
  );

  if (servers.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        {browserCard}
        <div className="rounded-lg border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
          {t('settings.selectServerHint')}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {browserCard}

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
            <h2 className="text-base font-semibold text-foreground">{t('settings.notifications.tabTitle')}</h2>
          </div>

          <div className="flex flex-col gap-3">
            <label className="text-xs text-muted-foreground">{t('settings.notifications.channelsLabel')}</label>
            <div className="flex flex-col gap-3">
              <Toggle
                checked={channelBrowser}
                onChange={setChannelBrowser}
                disabled={saving}
                label={t('settings.notifications.channelBrowser')}
                icon={<Monitor size={14} />}
              />
              <Toggle
                checked={channelTelegram && telegramConfigured}
                onChange={setChannelTelegram}
                disabled={saving || !telegramConfigured}
                label={t('settings.notifications.channelTelegram')}
                icon={<Send size={14} />}
              />
              {!telegramConfigured && (
                <p className="text-[11px] text-muted-foreground pl-[46px]">{t('settings.notifications.telegramNotConfigured')}</p>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">{t('settings.notifications.timeoutLabel')}</label>
            <input
              type="number"
              min={15}
              max={3600}
              value={timeoutSecs}
              onChange={(e) => setTimeoutSecs(e.target.value)}
              disabled={saving}
              className="px-3 py-2 rounded-md bg-input border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring w-32"
            />
            <p className="text-[11px] text-muted-foreground">{t('settings.notifications.timeoutHint')}</p>
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
