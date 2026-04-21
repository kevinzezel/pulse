'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import {
  FileText, Plus, Pencil, Check, Trash2, Loader, X, Copy, Send, CornerDownLeft, Terminal,
  Search,
} from 'lucide-react';
import {
  getPrompts, createPrompt, updatePrompt, deletePrompt,
  getSessions, sendTextToSession, composeSessionId,
} from '@/services/api';
import { useTranslation, useErrorToast } from '@/providers/I18nProvider';
import { useServers } from '@/providers/ServersProvider';
import { useProjects } from '@/providers/ProjectsProvider';
import ServerTag from '@/components/ServerTag';

export default function PromptsPage() {
  const { t } = useTranslation();
  const showError = useErrorToast();
  const router = useRouter();
  const { servers } = useServers();
  const { activeProjectId } = useProjects();

  const [prompts, setPrompts] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorPrompt, setEditorPrompt] = useState(null);
  const [editorName, setEditorName] = useState('');
  const [editorBody, setEditorBody] = useState('');
  const [editorIsGlobal, setEditorIsGlobal] = useState(false);
  const [saving, setSaving] = useState(false);

  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const [sendingPrompt, setSendingPrompt] = useState(null);
  const [sendingKey, setSendingKey] = useState(null);

  const [copiedId, setCopiedId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = await getPrompts();
      const allPrompts = p.prompts || [];
      setPrompts(allPrompts.filter((pr) => !pr.project_id || pr.project_id === activeProjectId));
      if (servers.length === 0) {
        setSessions([]);
      } else {
        const results = await Promise.allSettled(servers.map(srv => getSessions(srv.id)));
        const merged = [];
        results.forEach((r, i) => {
          if (r.status === 'fulfilled') {
            const srv = servers[i];
            merged.push(...(r.value.sessions || [])
              .filter((s) => !s.project_id || s.project_id === activeProjectId)
              .map(s => ({
                ...s,
                id: composeSessionId(srv.id, s.id),
                server_id: srv.id,
                server_name: srv.name,
                server_color: srv.color,
              })));
          }
        });
        setSessions(merged);
      }
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
  }, [servers, showError, activeProjectId]);

  useEffect(() => { load(); }, [load]);

  const filteredPrompts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return prompts;
    return prompts.filter(p => p.name.toLowerCase().includes(q));
  }, [prompts, searchQuery]);

  const globalPrompts = useMemo(
    () => filteredPrompts.filter((p) => !p.project_id),
    [filteredPrompts]
  );
  const projectPrompts = useMemo(
    () => filteredPrompts.filter((p) => p.project_id === activeProjectId),
    [filteredPrompts, activeProjectId]
  );

  function openEditor(prompt = null) {
    setEditorPrompt(prompt);
    setEditorName(prompt?.name || '');
    setEditorBody(prompt?.body || '');
    setEditorIsGlobal(prompt ? !prompt.project_id : false);
    setEditorOpen(true);
  }

  function closeEditor() {
    setEditorOpen(false);
    setEditorPrompt(null);
    setEditorName('');
    setEditorBody('');
    setEditorIsGlobal(false);
  }

  async function handleSave(e) {
    e.preventDefault();
    const name = editorName.trim();
    if (!name) return;
    setSaving(true);
    try {
      if (editorPrompt) {
        const data = await updatePrompt(editorPrompt.id, {
          name,
          body: editorBody,
          isGlobal: editorIsGlobal,
        });
        setPrompts(prev => prev.map(p => p.id === data.prompt.id ? data.prompt : p));
        toast.success(t(data.detail_key));
      } else {
        const data = await createPrompt({ name, body: editorBody, isGlobal: editorIsGlobal });
        setPrompts(prev => [data.prompt, ...prev]);
        toast.success(t(data.detail_key));
      }
      closeEditor();
    } catch (err) {
      showError(err);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirmDeleteId) return;
    setDeleting(true);
    try {
      const data = await deletePrompt(confirmDeleteId);
      setPrompts(prev => prev.filter(p => p.id !== confirmDeleteId));
      setConfirmDeleteId(null);
      toast.success(t(data.detail_key));
    } catch (err) {
      showError(err);
    } finally {
      setDeleting(false);
    }
  }

  async function handleCopy(prompt) {
    const text = prompt.body || '';
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopiedId(prompt.id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  async function handleSend(sessionId, sendEnter) {
    if (!sendingPrompt) return;
    const key = `${sessionId}:${sendEnter ? '1' : '0'}`;
    setSendingKey(key);
    try {
      const data = await sendTextToSession(sessionId, sendingPrompt.body || '', sendEnter);
      toast.success(data.detail);
      setSendingPrompt(null);
      router.push(`/?session=${encodeURIComponent(sessionId)}`);
    } catch (err) {
      showError(err);
    } finally {
      setSendingKey(null);
    }
  }

  function formatAge(iso) {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return t('time.now');
    if (mins < 60) return t('time.minutes', { n: mins });
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return t('time.hours', { n: hrs });
    const days = Math.floor(hrs / 24);
    return t('time.days', { n: days });
  }

  function bodyPreview(body) {
    if (!body) return '';
    const lines = body.split('\n').slice(0, 3).join('\n');
    if (lines.length > 220) return lines.slice(0, 220) + '…';
    return lines;
  }

  function renderPromptCard(prompt) {
    const isCopied = copiedId === prompt.id;
    const isGlobal = !prompt.project_id;
    return (
      <li
        key={prompt.id}
        className="p-4 rounded-md border border-border bg-card"
      >
        <div className="flex items-start gap-3 mb-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-foreground truncate">{prompt.name}</span>
              {isGlobal && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary font-medium">
                  {t('prompts.globalBadge')}
                </span>
              )}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              {formatAge(prompt.updated_at)}
            </div>
          </div>
          <div className="flex gap-1 flex-shrink-0">
            <button
              onClick={() => handleCopy(prompt)}
              className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
              title={t('prompts.copy')}
            >
              {isCopied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
            </button>
            <button
              onClick={() => setSendingPrompt(prompt)}
              className="p-2 rounded-md text-muted-foreground hover:text-primary hover:bg-muted/40 transition-colors"
              title={t('prompts.send')}
            >
              <Send size={14} />
            </button>
            <button
              onClick={() => openEditor(prompt)}
              className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
              title={t('prompts.edit')}
            >
              <Pencil size={14} />
            </button>
            <button
              onClick={() => setConfirmDeleteId(prompt.id)}
              className="p-2 rounded-md text-muted-foreground hover:text-destructive hover:bg-muted/40 transition-colors"
              title={t('prompts.delete')}
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
        {prompt.body && (
          <pre className="text-xs text-muted-foreground bg-muted/30 rounded px-2 py-1.5 whitespace-pre-wrap break-words font-mono max-h-24 overflow-hidden">
            {bodyPreview(prompt.body)}
          </pre>
        )}
      </li>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-4 sm:px-8 py-6 sm:py-10">
      <div className="max-w-3xl mx-auto">
        <header className="mb-6">
          <div className="flex items-center gap-3 mb-1">
            <FileText className="w-6 h-6 text-primary" />
            <h1 className="text-2xl font-bold text-foreground">{t('prompts.pageTitle')}</h1>
          </div>
          <p className="text-sm text-muted-foreground">{t('prompts.pageSubtitle')}</p>
        </header>

        <div className="mb-4 flex flex-col sm:flex-row gap-2">
          <button
            onClick={() => openEditor()}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium text-white bg-brand-gradient hover:opacity-90 transition-opacity"
          >
            <Plus size={16} />
            {t('prompts.newPrompt')}
          </button>
          <div className="flex-1 flex items-center gap-2 rounded-md border border-border bg-input px-3 py-2">
            <Search size={14} className="text-muted-foreground flex-shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('prompts.searchPlaceholder')}
              className="flex-1 min-w-0 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                title={t('prompts.clearSearch')}
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-10">
            <Loader className="w-5 h-5 text-muted-foreground animate-spin" />
          </div>
        )}

        {!loading && prompts.length === 0 && (
          <div className="py-10 text-center text-muted-foreground text-sm">
            {t('prompts.empty')}
          </div>
        )}

        {!loading && prompts.length > 0 && filteredPrompts.length === 0 && (
          <div className="py-10 text-center text-muted-foreground text-sm">
            {t('prompts.noResults')}
          </div>
        )}

        {!loading && filteredPrompts.length > 0 && (
          <div className="space-y-6">
            {globalPrompts.length > 0 && (
              <section>
                <h2 className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold mb-2 px-1">
                  {t('prompts.sectionGlobal')}
                </h2>
                <ul className="space-y-2">
                  {globalPrompts.map(renderPromptCard)}
                </ul>
              </section>
            )}
            {projectPrompts.length > 0 && (
              <section>
                <h2 className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold mb-2 px-1">
                  {t('prompts.sectionProject')}
                </h2>
                <ul className="space-y-2">
                  {projectPrompts.map(renderPromptCard)}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>

      {editorOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/60 px-4 py-6">
          <form
            onSubmit={handleSave}
            className="bg-card border border-border rounded-lg p-5 sm:p-6 w-full max-w-lg sm:max-w-3xl flex flex-col gap-4 max-h-full overflow-y-auto"
          >
            <h3 className="text-foreground font-semibold">
              {editorPrompt ? t('prompts.editTitle') : t('prompts.newTitle')}
            </h3>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">{t('prompts.nameLabel')}</label>
              <input
                type="text"
                value={editorName}
                onChange={(e) => setEditorName(e.target.value)}
                placeholder={t('prompts.namePlaceholder')}
                maxLength={80}
                autoFocus
                disabled={saving}
                className="px-3 py-2 rounded-md bg-input border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">{t('prompts.bodyLabel')}</label>
              <textarea
                value={editorBody}
                onChange={(e) => setEditorBody(e.target.value)}
                placeholder={t('prompts.bodyPlaceholder')}
                rows={10}
                disabled={saving}
                spellCheck={false}
                className="px-3 py-2 rounded-md bg-input border border-border text-sm text-foreground font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y min-h-[180px] sm:min-h-[420px]"
              />
            </div>
            <label className="flex items-start gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={editorIsGlobal}
                onChange={(e) => setEditorIsGlobal(e.target.checked)}
                disabled={saving}
                className="mt-0.5 accent-primary"
              />
              <span className="flex flex-col">
                <span className="text-sm text-foreground">{t('prompts.makeGlobal')}</span>
                <span className="text-xs text-muted-foreground">{t('prompts.makeGlobalHelp')}</span>
              </span>
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={closeEditor}
                disabled={saving}
                className="flex-1 py-2 rounded-md text-sm font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-50"
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                disabled={saving || !editorName.trim()}
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 rounded-md text-sm font-medium text-white bg-brand-gradient hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {saving ? <Loader size={14} className="animate-spin" /> : <Check size={14} />}
                {saving ? t('prompts.saving') : t('prompts.save')}
              </button>
            </div>
          </form>
        </div>
      )}

      {confirmDeleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/60 px-4">
          <div className="bg-card border border-border rounded-lg p-6 w-full max-w-sm">
            <h3 className="text-foreground font-semibold mb-2">{t('prompts.deleteConfirmTitle')}</h3>
            <p className="text-sm text-muted-foreground mb-4">{t('prompts.deleteConfirmMessage')}</p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmDeleteId(null)}
                disabled={deleting}
                className="flex-1 py-2 rounded-md text-sm font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-50"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 rounded-md text-sm font-medium text-white bg-destructive hover:bg-destructive/80 transition-colors disabled:opacity-50"
              >
                {deleting && <Loader size={14} className="animate-spin" />}
                {t('prompts.deleteConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {sendingPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/60 px-4 py-6">
          <div className="bg-card border border-border rounded-lg p-5 w-full max-w-md flex flex-col gap-3 max-h-full overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-foreground font-semibold">{t('prompts.sendTitle')}</h3>
              <button
                onClick={() => setSendingPrompt(null)}
                disabled={sendingKey !== null}
                className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                <X size={16} />
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('prompts.sendSubtitle', { name: sendingPrompt.name })}
            </p>
            {sessions.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                {t('prompts.noSessions')}
              </div>
            ) : (
              <ul className="space-y-2">
                {sessions.map(s => (
                  <li
                    key={s.id}
                    className="flex items-center gap-2 p-2 rounded-md border border-border"
                  >
                    <Terminal size={14} className="text-muted-foreground flex-shrink-0" />
                    <span className="flex-1 min-w-0 truncate text-sm text-foreground">{s.name}</span>
                    {servers.length > 1 && s.server_name && (
                      <ServerTag name={s.server_name} color={s.server_color} />
                    )}
                    <button
                      onClick={() => handleSend(s.id, false)}
                      disabled={sendingKey !== null}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-50"
                    >
                      {sendingKey === `${s.id}:0` ? <Loader size={12} className="animate-spin" /> : <Send size={12} />}
                      {t('prompts.sendOnly')}
                    </button>
                    <button
                      onClick={() => handleSend(s.id, true)}
                      disabled={sendingKey !== null}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-white bg-brand-gradient hover:opacity-90 disabled:opacity-50"
                    >
                      {sendingKey === `${s.id}:1` ? <Loader size={12} className="animate-spin" /> : <CornerDownLeft size={12} />}
                      {t('prompts.sendEnter')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
