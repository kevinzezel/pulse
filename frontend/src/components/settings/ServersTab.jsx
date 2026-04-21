'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Pencil, Trash2, Check, X, Loader, Eye, EyeOff, PlugZap, Wifi, WifiOff } from 'lucide-react';
import { useTranslation, useErrorToast } from '@/providers/I18nProvider';
import { useServers } from '@/providers/ServersProvider';

const COLOR_PRESETS = [
  '213 94% 60%',
  '142 71% 45%',
  '38 92% 50%',
  '12 88% 58%',
  '262 80% 62%',
  '340 82% 60%',
  '176 70% 44%',
  '220 10% 55%',
];

function emptyDraft() {
  return { id: null, name: '', protocol: 'http', host: '', port: 8000, apiKey: '', color: COLOR_PRESETS[0] };
}

function ColorSwatch({ value, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-6 h-6 rounded-full border-2 transition-transform ${
        active ? 'border-foreground scale-110' : 'border-transparent hover:scale-105'
      }`}
      style={{ background: `hsl(${value})` }}
      title={value}
    />
  );
}

function timeoutSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return { signal: AbortSignal.timeout(ms), cancel: () => {} };
  }
  const controller = new AbortController();
  const handle = setTimeout(() => controller.abort(new DOMException('timeout', 'TimeoutError')), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(handle) };
}

async function testServer(server) {
  const scheme = server.protocol === 'https' ? 'https' : 'http';
  const base = `${scheme}://${server.host}:${server.port}`;
  const t1 = timeoutSignal(3500);
  try {
    const health = await fetch(`${base}/health`, { signal: t1.signal });
    if (!health.ok) return { ok: false, reason: 'health_fail' };
  } catch (err) {
    const isTimeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    return { ok: false, reason: isTimeout ? 'timeout' : 'unreachable' };
  } finally {
    t1.cancel();
  }

  const t2 = timeoutSignal(3500);
  try {
    const auth = await fetch(`${base}/api/sessions`, {
      headers: { 'X-API-Key': server.apiKey },
      signal: t2.signal,
    });
    if (auth.status === 401) return { ok: false, reason: 'bad_key' };
    if (!auth.ok) return { ok: false, reason: 'unknown' };
    return { ok: true };
  } catch (err) {
    const isTimeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    return { ok: false, reason: isTimeout ? 'timeout' : 'unreachable' };
  } finally {
    t2.cancel();
  }
}

export default function ServersTab({ initialEditId = null }) {
  const { t } = useTranslation();
  const showError = useErrorToast();
  const { servers, save } = useServers();

  const [draft, setDraft] = useState(null);
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState(null);
  const [testResults, setTestResults] = useState({});
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [forceSaveProbe, setForceSaveProbe] = useState(null);

  const editing = useMemo(() => draft && draft.id !== null, [draft]);
  const draftKey = draft ? (draft.id || '__draft__') : null;
  const draftProbe = draftKey ? testResults[draftKey] : null;

  const autoEditConsumedRef = useRef(false);
  useEffect(() => {
    if (autoEditConsumedRef.current) return;
    if (!initialEditId) return;
    const target = servers.find(s => s.id === initialEditId);
    if (!target) return;
    autoEditConsumedRef.current = true;
    beginEdit(target);
  }, [initialEditId, servers]);

  const probedIdsRef = useRef(new Set());
  useEffect(() => {
    if (servers.length === 0) return;

    const toProbe = servers.filter(s => !probedIdsRef.current.has(s.id));
    if (toProbe.length === 0) return;

    toProbe.forEach(s => probedIdsRef.current.add(s.id));

    let cancelled = false;
    (async () => {
      const results = await Promise.all(toProbe.map(async s => [s.id, await testServer(s)]));
      if (cancelled) return;
      setTestResults(prev => {
        const next = { ...prev };
        results.forEach(([id, res]) => { next[id] = res; });
        return next;
      });
    })();
    return () => {
      cancelled = true;
      toProbe.forEach(s => probedIdsRef.current.delete(s.id));
    };
  }, [servers]);

  function updateDraft(patch) {
    setDraft(d => ({ ...d, ...patch }));
    if (draftKey) setTestResults(prev => ({ ...prev, [draftKey]: null }));
    setForceSaveProbe(null);
  }

  function beginCreate() {
    setDraft(emptyDraft());
    setShowKey(false);
    setForceSaveProbe(null);
  }

  function beginEdit(server) {
    setDraft({
      id: server.id,
      name: server.name || '',
      protocol: server.protocol || 'http',
      host: server.host || '',
      port: server.port || 8000,
      apiKey: server.apiKey || '',
      color: server.color || COLOR_PRESETS[0],
    });
    setShowKey(false);
    setForceSaveProbe(null);
  }

  function cancel() {
    setDraft(null);
    setForceSaveProbe(null);
  }

  async function persistDraft(candidate) {
    const editedId = draft.id;
    const next = editing
      ? servers.map(s => s.id === draft.id ? { ...s, ...candidate } : s)
      : [...servers, candidate];
    await save(next);
    if (editing && editedId) {
      probedIdsRef.current.delete(editedId);
      setTestResults(prev => {
        const copy = { ...prev };
        delete copy[editedId];
        return copy;
      });
    }
    setDraft(null);
    setForceSaveProbe(null);
    toast.success(t('settings.servers.saved'));
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!draft) return;
    const name = draft.name.trim();
    const host = draft.host.trim();
    if (!name || !host) return;
    const portNum = Number(draft.port);
    if (!Number.isFinite(portNum) || portNum < 1 || portNum > 65535) {
      toast.error(t('settings.servers.invalidPort'));
      return;
    }
    const protocol = draft.protocol === 'https' ? 'https' : 'http';
    const candidate = { name, protocol, host, port: portNum, apiKey: draft.apiKey, color: draft.color };
    setSaving(true);
    try {
      const probe = await testServer(candidate);
      if (!probe.ok) {
        setTestResults(prev => ({ ...prev, [draft.id || '__draft__']: probe }));
        setForceSaveProbe(probe);
        return;
      }
      await persistDraft(candidate);
    } catch (err) {
      showError(err);
    } finally {
      setSaving(false);
    }
  }

  async function handleForceSave() {
    if (!draft) return;
    const name = draft.name.trim();
    const host = draft.host.trim();
    if (!name || !host) return;
    const portNum = Number(draft.port);
    if (!Number.isFinite(portNum) || portNum < 1 || portNum > 65535) {
      toast.error(t('settings.servers.invalidPort'));
      return;
    }
    const protocol = draft.protocol === 'https' ? 'https' : 'http';
    const candidate = { name, protocol, host, port: portNum, apiKey: draft.apiKey, color: draft.color };
    setSaving(true);
    try {
      await persistDraft(candidate);
    } catch (err) {
      showError(err);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    try {
      await save(servers.filter(s => s.id !== id));
      setConfirmDeleteId(null);
      toast.success(t('settings.servers.deleted'));
    } catch (err) {
      showError(err);
    }
  }

  async function handleTest(server) {
    setTestingId(server.id);
    setTestResults(prev => ({ ...prev, [server.id]: null }));
    const result = await testServer(server);
    setTestResults(prev => ({ ...prev, [server.id]: result }));
    setTestingId(null);
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">{t('settings.servers.title')}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{t('settings.servers.subtitle')}</p>
        </div>
        {!draft && (
          <button
            onClick={beginCreate}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-white bg-brand-gradient hover:opacity-90 transition-opacity"
          >
            <Plus size={14} />
            {t('settings.servers.add')}
          </button>
        )}
      </header>

      {draft && (
        <form
          onSubmit={handleSave}
          className="rounded-lg border border-border bg-card p-4 flex flex-col gap-3"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">{t('settings.servers.nameLabel')}</label>
              <input
                type="text"
                value={draft.name}
                onChange={e => updateDraft({ name: e.target.value })}
                placeholder={t('settings.servers.namePlaceholder')}
                maxLength={40}
                required
                disabled={saving}
                className="px-3 py-2 rounded-md bg-input border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">{t('settings.servers.hostLabel')}</label>
              <div className="flex items-stretch gap-1">
                <select
                  value={draft.protocol}
                  onChange={e => updateDraft({ protocol: e.target.value })}
                  disabled={saving}
                  title={t('settings.servers.protocolLabel')}
                  className="px-2 rounded-md bg-input border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring font-mono"
                >
                  <option value="http">{t('settings.servers.protocol.http')}</option>
                  <option value="https">{t('settings.servers.protocol.https')}</option>
                </select>
                <input
                  type="text"
                  value={draft.host}
                  onChange={e => updateDraft({ host: e.target.value })}
                  placeholder={t('settings.servers.hostPlaceholder')}
                  required
                  disabled={saving}
                  className="flex-1 min-w-0 px-3 py-2 rounded-md bg-input border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring font-mono"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">{t('settings.servers.portLabel')}</label>
              <input
                type="number"
                min={1}
                max={65535}
                value={draft.port}
                onChange={e => updateDraft({ port: e.target.value })}
                required
                disabled={saving}
                className="px-3 py-2 rounded-md bg-input border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring font-mono"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">{t('settings.servers.apiKeyLabel')}</label>
              <div className="flex items-stretch gap-1">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={draft.apiKey}
                  onChange={e => updateDraft({ apiKey: e.target.value })}
                  placeholder={t('settings.servers.apiKeyPlaceholder')}
                  disabled={saving}
                  autoComplete="off"
                  className="flex-1 px-3 py-2 rounded-md bg-input border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(v => !v)}
                  className="px-3 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                  title={showKey ? t('settings.notifications.hideToken') : t('settings.notifications.showToken')}
                >
                  {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">{t('settings.servers.colorLabel')}</label>
            <div className="flex items-center gap-2 flex-wrap">
              {COLOR_PRESETS.map(preset => (
                <ColorSwatch
                  key={preset}
                  value={preset}
                  active={draft.color === preset}
                  onClick={() => updateDraft({ color: preset })}
                />
              ))}
              <input
                type="text"
                value={draft.color}
                onChange={e => updateDraft({ color: e.target.value })}
                placeholder="H S% L%"
                disabled={saving}
                className="px-2 py-1 rounded-md bg-input border border-border text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring font-mono w-28"
              />
            </div>
          </div>

          {forceSaveProbe && !forceSaveProbe.ok && (
            <p className="text-[11px] text-destructive bg-destructive/10 border border-destructive/40 rounded px-2 py-1">
              {t('settings.servers.saveBlocked', {
                reason: t(`settings.servers.test.reason.${forceSaveProbe.reason}`),
              })}
            </p>
          )}

          <div className="flex gap-2 pt-1 flex-wrap">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-white bg-brand-gradient hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {saving ? <Loader size={13} className="animate-spin" /> : <Check size={13} />}
              {saving ? t('settings.servers.testingAndSaving') : t('settings.servers.save')}
            </button>
            {forceSaveProbe && !forceSaveProbe.ok && (
              <button
                type="button"
                onClick={handleForceSave}
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border border-destructive/50 text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
              >
                {t('settings.servers.forceSave')}
              </button>
            )}
            <button
              type="button"
              onClick={cancel}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
            >
              <X size={13} />
              {t('settings.servers.cancel')}
            </button>
          </div>
        </form>
      )}

      {servers.length === 0 && !draft && (
        <div className="rounded-lg border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
          {t('settings.servers.empty')}
        </div>
      )}

      <ul className="flex flex-col gap-2">
        {servers.map(s => {
          const result = testResults[s.id];
          const swatchColor = s.color || '220 10% 55%';
          const probing = testingId === s.id || result == null;
          const statusTitle = probing
            ? '...'
            : result.ok
              ? t('sidebar.serverStatusOnline')
              : t(`settings.servers.test.reason.${result.reason}`);
          const StatusIcon = probing
            ? Wifi
            : result.ok
              ? Wifi
              : WifiOff;
          const statusIconClass = probing
            ? 'text-muted-foreground/40 animate-pulse'
            : result.ok
              ? 'text-success'
              : 'text-destructive';
          return (
            <li
              key={s.id}
              className="rounded-lg border border-border bg-card p-3 flex items-center gap-3"
            >
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ background: `hsl(${swatchColor})` }}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground font-medium truncate flex items-center gap-1.5">
                  <StatusIcon
                    size={13}
                    className={`flex-shrink-0 ${statusIconClass}`}
                    title={statusTitle}
                  />
                  {s.name}
                </p>
                <p className="text-[11px] text-muted-foreground font-mono truncate">
                  {(s.protocol || 'http')}://{s.host}:{s.port}
                </p>
              </div>
              {result && !result.ok && (
                <span className="text-[11px] px-2 py-0.5 rounded bg-destructive/15 text-destructive">
                  {t(`settings.servers.test.reason.${result.reason}`)}
                </span>
              )}
              <button
                onClick={() => handleTest(s)}
                disabled={testingId === s.id}
                className="inline-flex items-center justify-center p-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-50"
                title={t('settings.servers.testAction')}
              >
                {testingId === s.id ? <Loader size={14} className="animate-spin" /> : <PlugZap size={14} />}
              </button>
              <button
                onClick={() => beginEdit(s)}
                className="inline-flex items-center justify-center p-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                title={t('settings.servers.editAction')}
              >
                <Pencil size={14} />
              </button>
              <button
                onClick={() => setConfirmDeleteId(s.id)}
                className="inline-flex items-center justify-center p-1.5 rounded-md border border-border text-muted-foreground hover:text-destructive transition-colors"
                title={t('settings.servers.deleteAction')}
              >
                <Trash2 size={14} />
              </button>
            </li>
          );
        })}
      </ul>

      {confirmDeleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/60">
          <div className="bg-card border border-border rounded-lg p-6 w-80">
            <h3 className="text-foreground font-semibold mb-2">
              {t('settings.servers.deleteConfirmTitle')}
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              {t('settings.servers.deleteConfirmMessage')}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="flex-1 py-2 rounded-md text-sm font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
              >
                {t('settings.servers.cancel')}
              </button>
              <button
                onClick={() => handleDelete(confirmDeleteId)}
                className="flex-1 py-2 rounded-md text-sm font-medium text-white bg-destructive hover:bg-destructive/80 transition-colors"
              >
                {t('settings.servers.deleteConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
