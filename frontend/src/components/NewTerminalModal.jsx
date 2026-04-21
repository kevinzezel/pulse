'use client';

import { useState } from 'react';
import { X, Copy, Check } from 'lucide-react';
import { useTranslation } from '@/providers/I18nProvider';

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

export default function NewTerminalModal({ onClose, onSubmit, loading, groups = [], servers = [], defaultGroupId = null }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [groupId, setGroupId] = useState(defaultGroupId);
  const [copied, setCopied] = useState(false);
  const [serverId, setServerId] = useState(() => {
    try {
      const stored = typeof window !== 'undefined' ? localStorage.getItem('rt:lastServerId') : null;
      if (stored && servers.some(s => s.id === stored)) return stored;
    } catch {}
    return servers[0]?.id || '';
  });

  function handleSubmit(e) {
    e.preventDefault();
    if (!serverId) return;
    try { localStorage.setItem('rt:lastServerId', serverId); } catch {}
    onSubmit(serverId, name.trim() || null, groupId);
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
      <div className="bg-card border border-border rounded-lg p-6 w-full max-w-sm">
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
                {servers.map(s => (
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
            {groups.map(g => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>

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
