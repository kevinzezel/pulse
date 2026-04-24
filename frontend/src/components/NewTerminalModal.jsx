'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Copy, Check, Folder, ChevronUp, Loader, Eye, EyeOff } from 'lucide-react';
import { useTranslation } from '@/providers/I18nProvider';
import { listRemoteDirectory, getRecentCwds, deleteRecentCwd } from '@/services/api';

function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text);
  } else {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
}

function joinPath(base, name) {
  if (base === '/') return `/${name}`;
  return `${base}/${name}`;
}

function CwdBrowser({ serverId, showHidden, onToggleHidden, onPick, onServerOffline }) {
  const { t } = useTranslation();
  const [path, setPath] = useState(null);
  const [entries, setEntries] = useState([]);
  const [parent, setParent] = useState(null);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const reqIdRef = useRef(0);

  function navigate(targetPath) {
    const myReqId = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    listRemoteDirectory(serverId, targetPath)
      .then((res) => {
        if (myReqId !== reqIdRef.current) return; // Stale response.
        setPath(res.path);
        setEntries(Array.isArray(res.entries) ? res.entries : []);
        setParent(res.parent || null);
        setTruncated(!!res.truncated);
        onPick?.(res.path);
      })
      .catch((err) => {
        if (myReqId !== reqIdRef.current) return;
        const msg = err?.detail || err?.message || 'Error';
        setError(msg);
        // If the server is unreachable, surface it to parent so the browse
        // button can be disabled and tooltip swapped.
        if (err?.reason === 'unreachable' || err?.reason === 'timeout') {
          onServerOffline?.();
        }
      })
      .finally(() => {
        if (myReqId === reqIdRef.current) setLoading(false);
      });
  }

  // Initial load + reload on serverId change.
  useEffect(() => {
    if (!serverId) return;
    navigate(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId]);

  const visibleEntries = showHidden
    ? entries
    : entries.filter((e) => !e.name.startsWith('.'));

  const totalShown = entries.length;

  return (
    <div className="mb-4 border border-border rounded-md overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-muted/30 border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={() => parent && navigate(parent)}
            disabled={!parent || loading}
            className="text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0"
            title={parent ? t('modal.newTerminal.browser.parent', { path: parent }) : ''}
          >
            <ChevronUp size={16} />
          </button>
          <span className="text-xs text-muted-foreground truncate" title={path || ''}>
            {path || ''}
          </span>
        </div>
        <button
          type="button"
          onClick={onToggleHidden}
          className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs flex-shrink-0"
          title={t('modal.newTerminal.browser.showHidden')}
        >
          {showHidden ? <Eye size={14} /> : <EyeOff size={14} />}
        </button>
      </div>

      <div className="max-h-48 overflow-y-auto bg-card text-sm">
        {loading && (
          <div className="flex items-center justify-center py-4 text-muted-foreground">
            <Loader size={14} className="animate-spin mr-2" />
            {t('modal.newTerminal.browser.loading')}
          </div>
        )}
        {!loading && error && (
          <div className="px-3 py-2 text-xs text-destructive bg-destructive/10 border-b border-destructive/40">
            {error}
          </div>
        )}
        {!loading && !error && visibleEntries.length === 0 && (
          <div className="px-3 py-3 text-xs text-muted-foreground text-center">
            {t('modal.newTerminal.browser.empty')}
          </div>
        )}
        {!loading && visibleEntries.map((entry) => (
          <button
            key={entry.name}
            type="button"
            onClick={() => navigate(joinPath(path, entry.name))}
            className="w-full text-left px-3 py-1.5 flex items-center gap-2 text-foreground hover:bg-muted/40 transition-colors"
          >
            <Folder size={14} className="text-muted-foreground flex-shrink-0" />
            <span className="truncate">{entry.name}</span>
          </button>
        ))}
      </div>

      {truncated && (
        <div className="px-3 py-1.5 text-xs text-muted-foreground bg-muted/30 border-t border-border">
          {t('modal.newTerminal.browser.truncated', { n: visibleEntries.length, total: totalShown })}
        </div>
      )}
    </div>
  );
}

export default function NewTerminalModal({ onClose, onSubmit, loading, groups = [], servers = [], defaultGroupId = null }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [groupId, setGroupId] = useState(defaultGroupId);
  const [copied, setCopied] = useState(false);
  const [serverId, setServerId] = useState(() => {
    try {
      const stored = typeof window !== 'undefined' ? localStorage.getItem('rt:lastServerId') : null;
      if (stored && servers.some((s) => s.id === stored)) return stored;
    } catch {}
    return servers[0]?.id || '';
  });

  const [cwd, setCwd] = useState('');
  const [browserOpen, setBrowserOpen] = useState(false);
  const [showHidden, setShowHidden] = useState(() => {
    try { return typeof window !== 'undefined' && localStorage.getItem('rt:browserShowHidden') === '1'; }
    catch { return false; }
  });
  const [recents, setRecents] = useState([]);
  const [serverOnline, setServerOnline] = useState(true);

  // Reset cwd state and reload recents whenever serverId changes.
  useEffect(() => {
    setBrowserOpen(false);
    setCwd('');
    setServerOnline(true);
    if (!serverId) { setRecents([]); return; }
    let cancelled = false;
    getRecentCwds(serverId)
      .then((r) => { if (!cancelled) setRecents(Array.isArray(r?.paths) ? r.paths : []); })
      .catch((err) => {
        console.warn('getRecentCwds failed:', err);
        if (!cancelled) setRecents([]);
      });
    return () => { cancelled = true; };
  }, [serverId]);

  function handleToggleHidden() {
    setShowHidden((v) => {
      const next = !v;
      try { localStorage.setItem('rt:browserShowHidden', next ? '1' : '0'); } catch {}
      return next;
    });
  }

  function handleRemoveRecent(p) {
    // Optimistic: drop from local state immediately so the X feels instant.
    // If the DELETE fails, refetch to reconcile.
    setRecents((prev) => prev.filter((x) => x !== p));
    deleteRecentCwd(serverId, p).catch((err) => {
      console.warn('deleteRecentCwd failed:', err);
      getRecentCwds(serverId)
        .then((r) => setRecents(Array.isArray(r?.paths) ? r.paths : []))
        .catch(() => {});
    });
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!serverId) return;
    try { localStorage.setItem('rt:lastServerId', serverId); } catch {}
    const trimmedCwd = cwd.trim() || null;
    onSubmit(serverId, name.trim() || null, groupId, trimmedCwd);
  }

  const noServers = servers.length === 0;

  function handleCopy() {
    const sessionName = name.trim() || 'my-terminal';
    const cmd = `tmux new-session -s ${sessionName}`;
    copyToClipboard(cmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/60 px-4">
      <div className="bg-card border border-border rounded-lg p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-foreground font-semibold">{t('modal.newTerminal.title')}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {noServers && (
            <p className="mb-4 text-xs text-destructive bg-destructive/10 border border-destructive/40 rounded-md px-3 py-2">
              {t('modal.newTerminal.noServers')}
            </p>
          )}

          {servers.length > 1 && (
            <>
              <label className="block text-sm text-muted-foreground mb-1">
                {t('modal.newTerminal.serverLabel')}
              </label>
              <select
                value={serverId}
                onChange={(e) => setServerId(e.target.value)}
                disabled={loading}
                required
                className="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-ring mb-4"
              >
                {servers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name || `${s.host}:${s.port}`}</option>
                ))}
              </select>
            </>
          )}

          <label className="block text-sm text-muted-foreground mb-1">
            {t('modal.newTerminal.nameLabel')}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('modal.newTerminal.placeholder')}
            maxLength={50}
            autoFocus
            className="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring mb-4"
          />

          <label className="block text-sm text-muted-foreground mb-1">
            {t('modal.newTerminal.groupLabel')}
          </label>
          <select
            value={groupId || ''}
            onChange={(e) => setGroupId(e.target.value || null)}
            disabled={loading}
            className="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-ring mb-4"
          >
            <option value="">{t('modal.newTerminal.noGroup')}</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>

          <label className="block text-sm text-muted-foreground mb-1">
            {t('modal.newTerminal.cwdLabel')}
          </label>
          <div className="flex gap-2 mb-4">
            <input
              type="text"
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              placeholder={t('modal.newTerminal.cwdPlaceholder')}
              className="flex-1 px-3 py-2 bg-input border border-border rounded-md text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              type="button"
              onClick={() => setBrowserOpen((o) => !o)}
              disabled={!serverId || !serverOnline || loading}
              title={
                !serverId
                  ? ''
                  : !serverOnline
                  ? t('modal.newTerminal.browser.serverOffline')
                  : t('modal.newTerminal.browseTooltip')
              }
              className="px-3 py-2 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Folder size={16} />
            </button>
          </div>

          {browserOpen && serverId && (
            <CwdBrowser
              serverId={serverId}
              showHidden={showHidden}
              onToggleHidden={handleToggleHidden}
              onPick={setCwd}
              onServerOffline={() => setServerOnline(false)}
            />
          )}

          {recents.length > 0 && (
            <>
              <label className="block text-sm text-muted-foreground mb-1">
                {t('modal.newTerminal.recentLabel')}
              </label>
              <div className="mb-4 border border-border rounded-md max-h-40 overflow-y-auto bg-input">
                {recents.map((p) => (
                  <div
                    key={p}
                    className="flex items-center hover:bg-muted/40 transition-colors border-b border-border last:border-b-0"
                  >
                    <button
                      type="button"
                      onClick={() => setCwd(p)}
                      title={p}
                      className="flex-1 min-w-0 text-left px-3 py-1.5 text-sm text-foreground truncate"
                    >
                      {p}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemoveRecent(p)}
                      title={t('modal.newTerminal.recentRemoveTooltip')}
                      className="px-2 py-1.5 text-muted-foreground hover:text-destructive flex-shrink-0"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={loading || noServers}
              className="flex-1 py-2 rounded-md text-sm font-medium text-white bg-brand-gradient hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
            >
              {loading ? t('modal.newTerminal.creating') : t('modal.newTerminal.create')}
            </button>
            <button
              type="button"
              onClick={handleCopy}
              className="px-3 py-2 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
              title={t('modal.newTerminal.copyTooltip')}
            >
              {copied ? <Check size={16} className="text-success" /> : <Copy size={16} />}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
