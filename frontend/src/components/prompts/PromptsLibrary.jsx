'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import toast from 'react-hot-toast';
import {
  Plus, Search, X, Loader, Send, CornerDownLeft, Terminal as TerminalIcon, Menu,
} from 'lucide-react';
import {
  getPrompts, createPrompt, updatePrompt, deletePrompt,
  getPromptGroups, createPromptGroup, renamePromptGroup, deletePromptGroup,
  sendTextToSession, getSessions, composeSessionId,
} from '@/services/api';
import { useTranslation, useErrorToast } from '@/providers/I18nProvider';
import { useProjects } from '@/providers/ProjectsProvider';
import { useServers } from '@/providers/ServersProvider';
import { useViewState } from '@/providers/ViewStateProvider';
import { useIsMobile } from '@/hooks/layout';
import ServerTag from '@/components/ServerTag';
import PromptGroupSidebar from './PromptGroupSidebar';
import PromptList from './PromptList';
import PromptEditorPanel from './PromptEditorPanel';
import {
  PROMPT_GROUP_ALL,
  PROMPT_GROUP_PINNED,
  PROMPT_GROUP_UNGROUPED,
  PROMPT_SCOPE_VISIBLE,
  PROMPT_SCOPE_GLOBAL,
  PROMPT_SCOPE_PROJECT,
  VALID_PROMPT_SCOPES,
} from './promptConstants';
import {
  filterPromptsByScope,
  filterPromptsByGroupToken,
  searchPrompts,
  sortPrompts,
} from './promptUtils';

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text || '';
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
}

export default function PromptsLibrary() {
  const { t } = useTranslation();
  const showError = useErrorToast();
  const { activeProjectId } = useProjects();
  const { servers } = useServers();
  const isMobile = useIsMobile();
  const {
    setProjectPromptScope, getProjectPromptScope,
    setProjectPromptGroup, getProjectPromptGroup,
    setProjectPromptForGroup, getProjectPromptForGroup,
    setProjectPromptEmptyForGroup, isProjectPromptEmptyForGroup,
    hydrated: hydratedViewState,
  } = useViewState();

  const [prompts, setPrompts] = useState([]);
  const [groups, setGroups] = useState([]);
  const [promptsProjectId, setPromptsProjectId] = useState(null);
  const [groupsLoaded, setGroupsLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [renamingGroupId, setRenamingGroupId] = useState(null);
  const [deletingGroupId, setDeletingGroupId] = useState(null);

  const [editorMode, setEditorMode] = useState('empty'); // 'empty' | 'preview' | 'edit' | 'create'
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [confirmDeletePromptId, setConfirmDeletePromptId] = useState(null);
  const [deletingPrompt, setDeletingPrompt] = useState(false);

  const [sessions, setSessions] = useState([]);
  const [sendingPrompt, setSendingPrompt] = useState(null);
  const [sendingKey, setSendingKey] = useState(null);

  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const dataReady = hydratedViewState
    && promptsProjectId === activeProjectId
    && groupsLoaded;

  // ---------- load -------------------------------------------------------

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [promptsRes, groupsRes] = await Promise.all([
        getPrompts(),
        getPromptGroups(),
      ]);
      setPrompts(Array.isArray(promptsRes?.prompts) ? promptsRes.prompts : []);
      setPromptsProjectId(activeProjectId);
      setGroups(Array.isArray(groupsRes?.groups) ? groupsRes.groups : []);
      setGroupsLoaded(true);
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
  }, [activeProjectId, showError]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const loadSessions = useCallback(async () => {
    if (servers.length === 0) {
      setSessions([]);
      return;
    }
    try {
      const results = await Promise.allSettled(servers.map((srv) => getSessions(srv.id)));
      const merged = [];
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') {
          const srv = servers[i];
          merged.push(...(r.value.sessions || [])
            .filter((s) => !s.project_id || s.project_id === activeProjectId)
            .map((s) => ({
              ...s,
              id: composeSessionId(srv.id, s.id),
              server_id: srv.id,
              server_name: srv.name,
              server_color: srv.color,
            })));
        }
      });
      setSessions(merged);
    } catch (err) {
      showError(err);
    }
  }, [servers, activeProjectId, showError]);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  // ---------- derived state ----------------------------------------------

  const validGroupIds = useMemo(() => new Set(groups.map((g) => g.id)), [groups]);

  const rawScope = hydratedViewState ? getProjectPromptScope(activeProjectId) : null;
  const scope = VALID_PROMPT_SCOPES.includes(rawScope) ? rawScope : PROMPT_SCOPE_VISIBLE;

  const rawGroupToken = hydratedViewState ? getProjectPromptGroup(activeProjectId) : null;
  const groupToken = (() => {
    if (!rawGroupToken) return PROMPT_GROUP_ALL;
    if (rawGroupToken === PROMPT_GROUP_ALL) return PROMPT_GROUP_ALL;
    if (rawGroupToken === PROMPT_GROUP_PINNED) return PROMPT_GROUP_PINNED;
    if (rawGroupToken === PROMPT_GROUP_UNGROUPED) return PROMPT_GROUP_UNGROUPED;
    if (validGroupIds.has(rawGroupToken)) return rawGroupToken;
    return PROMPT_GROUP_ALL;
  })();

  const setScope = useCallback((next) => {
    if (!activeProjectId) return;
    setProjectPromptScope(activeProjectId, next);
  }, [activeProjectId, setProjectPromptScope]);

  const setGroupToken = useCallback((next) => {
    if (!activeProjectId) return;
    setProjectPromptGroup(activeProjectId, next);
  }, [activeProjectId, setProjectPromptGroup]);

  const scopeForSavedPrompt = useCallback((isGlobal) => {
    if (isGlobal && scope === PROMPT_SCOPE_PROJECT) return PROMPT_SCOPE_VISIBLE;
    if (!isGlobal && scope === PROMPT_SCOPE_GLOBAL) return PROMPT_SCOPE_VISIBLE;
    return scope;
  }, [scope]);

  const scopedPrompts = useMemo(
    () => filterPromptsByScope(prompts, activeProjectId, scope),
    [prompts, activeProjectId, scope],
  );

  const promptsInGroup = useMemo(
    () => filterPromptsByGroupToken(scopedPrompts, groupToken, validGroupIds),
    [scopedPrompts, groupToken, validGroupIds],
  );

  const filteredPrompts = useMemo(
    () => sortPrompts(searchPrompts(promptsInGroup, searchQuery)),
    [promptsInGroup, searchQuery],
  );

  const counts = useMemo(() => {
    const m = new Map();
    m.set(PROMPT_GROUP_ALL, scopedPrompts.length);
    m.set(PROMPT_GROUP_PINNED, scopedPrompts.filter((p) => p.pinned === true).length);
    m.set(PROMPT_GROUP_UNGROUPED, scopedPrompts.filter((p) => {
      const gid = p.group_id;
      return !gid || !validGroupIds.has(gid);
    }).length);
    for (const g of groups) {
      m.set(g.id, scopedPrompts.filter((p) => p.group_id === g.id).length);
    }
    return m;
  }, [scopedPrompts, groups, validGroupIds]);

  const selectedPromptId = hydratedViewState
    ? getProjectPromptForGroup(activeProjectId, groupToken)
    : null;
  const selectedPromptEmpty = hydratedViewState
    ? isProjectPromptEmptyForGroup(activeProjectId, groupToken)
    : false;

  const selectedPrompt = useMemo(
    () => filteredPrompts.find((p) => p.id === selectedPromptId) || null,
    [filteredPrompts, selectedPromptId],
  );

  // Auto-select first prompt when current selection isn't valid in this filter,
  // unless the user explicitly deselected (empty marker).
  useEffect(() => {
    if (!dataReady || loading) return;
    if (editorMode === 'create' || editorMode === 'edit') return;
    if (selectedPromptId && filteredPrompts.some((p) => p.id === selectedPromptId)) {
      if (editorMode !== 'preview') setEditorMode('preview');
      return;
    }
    if (selectedPromptEmpty) {
      if (editorMode !== 'empty') setEditorMode('empty');
      return;
    }
    if (filteredPrompts.length > 0) {
      setProjectPromptForGroup(activeProjectId, groupToken, filteredPrompts[0].id);
      setEditorMode('preview');
    } else {
      setEditorMode('empty');
    }
  }, [dataReady, loading, filteredPrompts, selectedPromptId, selectedPromptEmpty,
      editorMode, activeProjectId, groupToken, setProjectPromptForGroup]);

  // ---------- handlers ---------------------------------------------------

  function handleSelectGroupToken(token) {
    setGroupToken(token);
    if (isMobile) setMobileSidebarOpen(false);
  }

  function handleSelectPrompt(prompt) {
    setProjectPromptForGroup(activeProjectId, groupToken, prompt.id);
    setEditorMode('preview');
  }

  function handleStartCreate() {
    setEditorMode('create');
  }

  function handleStartEdit(prompt) {
    setProjectPromptForGroup(activeProjectId, groupToken, prompt.id);
    setEditorMode('edit');
  }

  function handleCancelEditor() {
    setEditorMode(selectedPrompt ? 'preview' : 'empty');
  }

  function handleBackToPromptList() {
    setProjectPromptEmptyForGroup(activeProjectId, groupToken);
    setEditorMode('empty');
  }

  async function handleSavePrompt(payload) {
    setSavingPrompt(true);
    try {
      if (editorMode === 'create') {
        const data = await createPrompt({
          name: payload.name,
          body: payload.body,
          isGlobal: payload.isGlobal,
          groupId: payload.groupId,
          pinned: payload.pinned,
        });
        setPrompts((prev) => [data.prompt, ...prev]);
        // Switch the visible group to where the prompt landed so the user sees
        // it; respects pinned-first by jumping to "Pinned" filter.
        let nextToken = payload.pinned
          ? PROMPT_GROUP_PINNED
          : (payload.groupId || PROMPT_GROUP_UNGROUPED);
        const nextScope = scopeForSavedPrompt(payload.isGlobal);
        if (nextScope !== scope) {
          setScope(nextScope);
        }
        if (nextToken !== groupToken) {
          setGroupToken(nextToken);
        }
        setProjectPromptForGroup(activeProjectId, nextToken, data.prompt.id);
        setEditorMode('preview');
        toast.success(t(data.detail_key));
      } else if (editorMode === 'edit' && selectedPrompt) {
        const data = await updatePrompt(selectedPrompt.id, {
          name: payload.name,
          body: payload.body,
          isGlobal: payload.isGlobal,
          groupId: payload.groupId,
          pinned: payload.pinned,
        });
        setPrompts((prev) => prev.map((p) => (p.id === data.prompt.id ? data.prompt : p)));
        // Follow the prompt if its new group/pinned state pulls it out of the
        // current filter — otherwise the auto-select effect would yank focus
        // to a sibling and the user would lose what they just edited.
        let nextToken = groupToken;
        if (groupToken === PROMPT_GROUP_PINNED && !payload.pinned) {
          nextToken = payload.groupId || PROMPT_GROUP_UNGROUPED;
        } else if (groupToken === PROMPT_GROUP_UNGROUPED && payload.groupId) {
          nextToken = payload.groupId;
        } else if (validGroupIds.has(groupToken) && payload.groupId !== groupToken) {
          nextToken = payload.groupId || PROMPT_GROUP_UNGROUPED;
        }
        const nextScope = scopeForSavedPrompt(payload.isGlobal);
        if (nextScope !== scope) {
          setScope(nextScope);
        }
        if (nextToken !== groupToken) {
          setGroupToken(nextToken);
        }
        setProjectPromptForGroup(activeProjectId, nextToken, data.prompt.id);
        setEditorMode('preview');
        toast.success(t(data.detail_key));
      }
    } catch (err) {
      showError(err);
    } finally {
      setSavingPrompt(false);
    }
  }

  function handleAskDeletePrompt(prompt) {
    setConfirmDeletePromptId(prompt.id);
  }

  async function handleConfirmDeletePrompt() {
    if (!confirmDeletePromptId) return;
    setDeletingPrompt(true);
    try {
      const data = await deletePrompt(confirmDeletePromptId);
      setPrompts((prev) => prev.filter((p) => p.id !== confirmDeletePromptId));
      setConfirmDeletePromptId(null);
      if (selectedPromptId === confirmDeletePromptId) {
        // If deleting the last prompt in this filter, mark the bucket as
        // explicitly empty so the auto-select effect doesn't immediately
        // jump to a sibling on next visit.
        const remaining = filteredPrompts.filter((p) => p.id !== confirmDeletePromptId);
        if (remaining.length === 0) {
          setProjectPromptEmptyForGroup(activeProjectId, groupToken);
        } else {
          setProjectPromptForGroup(activeProjectId, groupToken, null);
        }
        setEditorMode('empty');
      }
      toast.success(t(data.detail_key));
    } catch (err) {
      showError(err);
    } finally {
      setDeletingPrompt(false);
    }
  }

  async function handleCopy(prompt) {
    await copyToClipboard(prompt.body || '');
  }

  function handleSendStart(prompt) {
    if (sessions.length === 0) {
      toast(t('prompts.noSessions'));
      return;
    }
    setSendingPrompt(prompt);
  }

  async function handleSendToSession(sessionId, sendEnter) {
    if (!sendingPrompt) return;
    const key = `${sessionId}:${sendEnter ? '1' : '0'}`;
    setSendingKey(key);
    try {
      const data = await sendTextToSession(sessionId, sendingPrompt.body || '', sendEnter);
      toast.success(data.detail || t('prompts.sentToTerminal'));
      setSendingPrompt(null);
    } catch (err) {
      showError(err);
    } finally {
      setSendingKey(null);
    }
  }

  async function handleCreateGroup(name) {
    setCreatingGroup(true);
    try {
      const data = await createPromptGroup(name);
      setGroups((prev) => [...prev, data.group]);
      toast.success(t(data.detail_key));
    } catch (err) {
      showError(err);
      throw err;
    } finally {
      setCreatingGroup(false);
    }
  }

  async function handleRenameGroup(groupId, name) {
    setRenamingGroupId(groupId);
    try {
      const data = await renamePromptGroup(groupId, name);
      setGroups((prev) => prev.map((g) => (g.id === groupId ? data.group : g)));
      toast.success(t(data.detail_key));
    } catch (err) {
      showError(err);
      throw err;
    } finally {
      setRenamingGroupId(null);
    }
  }

  async function handleDeleteGroup(groupId) {
    setDeletingGroupId(groupId);
    try {
      const data = await deletePromptGroup(groupId);
      setGroups((prev) => prev.filter((g) => g.id !== groupId));
      // Clear group_id from any prompts pointing at this group in local state.
      setPrompts((prev) => prev.map((p) =>
        p.group_id === groupId ? { ...p, group_id: null } : p
      ));
      if (groupToken === groupId) {
        setGroupToken(PROMPT_GROUP_ALL);
      }
      toast.success(t(data.detail_key));
    } catch (err) {
      showError(err);
      throw err;
    } finally {
      setDeletingGroupId(null);
    }
  }

  // ---------- editor defaults --------------------------------------------

  const editorDefaultIsGlobal = scope === PROMPT_SCOPE_GLOBAL;
  const editorDefaultGroupId = (() => {
    if (groupToken === PROMPT_GROUP_ALL) return null;
    if (groupToken === PROMPT_GROUP_PINNED) return null;
    if (groupToken === PROMPT_GROUP_UNGROUPED) return null;
    if (validGroupIds.has(groupToken)) return groupToken;
    return null;
  })();
  const editorDefaultPinned = groupToken === PROMPT_GROUP_PINNED;

  // ---------- render -----------------------------------------------------

  const sidebar = (
    <PromptGroupSidebar
      groups={groups}
      counts={counts}
      selectedGroupToken={groupToken}
      onSelectGroup={handleSelectGroupToken}
      onCreateGroup={handleCreateGroup}
      onRenameGroup={handleRenameGroup}
      onDeleteGroup={handleDeleteGroup}
      creating={creatingGroup}
      renamingId={renamingGroupId}
      deletingId={deletingGroupId}
    />
  );

  const editor = (
    <PromptEditorPanel
      mode={editorMode}
      prompt={selectedPrompt}
      groups={groups}
      defaultIsGlobal={editorDefaultIsGlobal}
      defaultGroupId={editorDefaultGroupId}
      defaultPinned={editorDefaultPinned}
      onEnterEdit={() => setEditorMode('edit')}
      onCancel={handleCancelEditor}
      onBack={isMobile ? handleBackToPromptList : undefined}
      onSave={handleSavePrompt}
      onCopy={handleCopy}
      onSend={handleSendStart}
      saving={savingPrompt}
    />
  );

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Sidebar */}
        {!isMobile && (
          <div className="w-64 flex-shrink-0">{sidebar}</div>
        )}
        {isMobile && mobileSidebarOpen && (
          <>
            <div
              className="fixed inset-0 z-40 bg-overlay/60"
              onClick={() => setMobileSidebarOpen(false)}
            />
            <div className="fixed top-0 left-0 bottom-0 w-72 z-50">{sidebar}</div>
          </>
        )}

        {/* Center */}
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          <div className="flex-shrink-0 px-3 sm:px-4 py-3 border-b border-border flex items-center gap-2 flex-wrap">
            {isMobile && (
              <button
                type="button"
                onClick={() => setMobileSidebarOpen(true)}
                className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                title={t('prompts.groupLabel')}
              >
                <Menu size={16} />
              </button>
            )}
            <h1 className="text-base sm:text-lg font-semibold text-foreground">
              {t('prompts.pageTitle')}
            </h1>
            <div className="flex-1 min-w-[140px] flex items-center gap-2 rounded-md border border-border bg-input px-2 py-1.5">
              <Search size={13} className="text-muted-foreground flex-shrink-0" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('prompts.searchLibraryPlaceholder')}
                className="flex-1 min-w-0 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                  title={t('prompts.clearSearch')}
                >
                  <X size={13} />
                </button>
              )}
            </div>
            <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
              {[
                { value: PROMPT_SCOPE_VISIBLE, label: t('prompts.scopeVisible') },
                { value: PROMPT_SCOPE_GLOBAL, label: t('prompts.scopeGlobal') },
                { value: PROMPT_SCOPE_PROJECT, label: t('prompts.scopeProject') },
              ].map((opt) => (
                <button
                  type="button"
                  key={opt.value}
                  onClick={() => setScope(opt.value)}
                  className={`px-2 py-1 rounded text-xs transition-colors ${
                    scope === opt.value
                      ? 'bg-primary/15 text-primary'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={handleStartCreate}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium text-white bg-brand-gradient hover:opacity-90 transition-opacity"
            >
              <Plus size={14} />
              <span className="hidden sm:inline">{t('prompts.newPrompt')}</span>
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4">
            <PromptList
              prompts={filteredPrompts}
              groups={groups}
              selectedPromptId={selectedPromptId}
              loading={loading}
              onSelectPrompt={handleSelectPrompt}
              onEditPrompt={handleStartEdit}
              onDeletePrompt={handleAskDeletePrompt}
              onCopyPrompt={handleCopy}
              onSendPrompt={handleSendStart}
              sendMode="single"
              emptyMessage={
                searchQuery
                  ? t('prompts.emptySearch')
                  : t('prompts.emptyGroup')
              }
            />
          </div>
        </div>

        {/* Editor panel */}
        {!isMobile && (
          <div className="w-[380px] xl:w-[420px] flex-shrink-0 border-l border-border bg-card/40">
            {editor}
          </div>
        )}
        {isMobile && (editorMode !== 'empty') && (
          <div className="fixed inset-0 z-50 bg-background flex flex-col">
            {editor}
          </div>
        )}
      </div>

      {confirmDeletePromptId && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-overlay/60 px-4">
          <div className="bg-card border border-border rounded-lg p-6 w-full max-w-sm">
            <h3 className="text-foreground font-semibold mb-2">{t('prompts.deleteConfirmTitle')}</h3>
            <p className="text-sm text-muted-foreground mb-4">{t('prompts.deleteConfirmMessage')}</p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setConfirmDeletePromptId(null)}
                disabled={deletingPrompt}
                className="px-3 py-1.5 rounded text-sm border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 disabled:opacity-50"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={handleConfirmDeletePrompt}
                disabled={deletingPrompt}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded text-sm font-medium text-white bg-destructive hover:bg-destructive/80 disabled:opacity-50"
              >
                {deletingPrompt && <Loader size={12} className="animate-spin" />}
                {t('prompts.deleteConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {sendingPrompt && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-overlay/60 px-4 py-6">
          <div className="bg-card border border-border rounded-lg p-5 w-full max-w-md flex flex-col gap-3 max-h-full overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-foreground font-semibold">{t('prompts.sendTitle')}</h3>
              <button
                type="button"
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
                {sessions.map((s) => {
                  const sendOnlyClass = 'inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-white bg-brand-gradient hover:opacity-90 disabled:opacity-50';
                  const sendEnterClass = 'inline-flex items-center gap-1 px-2 py-1 rounded text-xs border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-50';
                  return (
                    <li
                      key={s.id}
                      className="flex items-center gap-2 p-2 rounded-md border border-border"
                    >
                      <TerminalIcon size={14} className="text-muted-foreground flex-shrink-0" />
                      <span className="flex-1 min-w-0 truncate text-sm text-foreground">{s.name}</span>
                      {servers.length > 1 && s.server_name && (
                        <ServerTag name={s.server_name} color={s.server_color} />
                      )}
                      <button
                        type="button"
                        onClick={() => handleSendToSession(s.id, false)}
                        disabled={sendingKey !== null}
                        className={sendOnlyClass}
                      >
                        {sendingKey === `${s.id}:0` ? <Loader size={12} className="animate-spin" /> : <Send size={12} />}
                        {t('prompts.sendOnly')}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSendToSession(s.id, true)}
                        disabled={sendingKey !== null}
                        className={sendEnterClass}
                      >
                        {sendingKey === `${s.id}:1` ? <Loader size={12} className="animate-spin" /> : <CornerDownLeft size={12} />}
                        {t('prompts.sendEnter')}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
