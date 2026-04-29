'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import {
  X, Search, Settings as SettingsIcon, Pin, Folder, FileText, Loader,
} from 'lucide-react';
import {
  getCombinedPrompts, getCombinedPromptGroups, sendTextToSession,
} from '@/services/api';
import { useTranslation, useErrorToast } from '@/providers/I18nProvider';
import { useProjects } from '@/providers/ProjectsProvider';
import {
  PROMPT_GROUP_ALL,
  PROMPT_GROUP_PINNED,
  PROMPT_GROUP_UNGROUPED,
  PROMPT_SCOPE_VISIBLE,
} from './promptConstants';
import {
  filterPromptsByScope,
  filterPromptsByGroupToken,
  effectivePromptGroupId,
  searchPrompts,
  sortPrompts,
} from './promptUtils';
import PromptList from './PromptList';

const EMPTY_ARRAY = Object.freeze([]);

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

export default function PromptQuickSelectorModal({ sessionId, open, onClose }) {
  const { t } = useTranslation();
  const router = useRouter();
  const showError = useErrorToast();
  const { activeProjectId } = useProjects();

  const [prompts, setPrompts] = useState([]);
  const [groups, setGroups] = useState([]);
  const [dataProjectId, setDataProjectId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [groupToken, setGroupToken] = useState(PROMPT_GROUP_ALL);
  const [sending, setSending] = useState(false);
  const [sendingKey, setSendingKey] = useState(null);

  // Reload data + reset state every time the modal is opened so a stale
  // search/filter from a previous open doesn't leak in. Refetches when
  // activeProjectId changes so the project-scoped half of the merged list
  // stays in sync.
  useEffect(() => {
    if (!open) return;
    if (!activeProjectId) return;
    setSearchQuery('');
    setGroupToken(PROMPT_GROUP_ALL);
    setSendingKey(null);
    setPrompts([]);
    setGroups([]);
    setDataProjectId(null);
    let cancelled = false;
    const projectId = activeProjectId;
    setLoading(true);
    (async () => {
      try {
        const [promptsList, groupsList] = await Promise.all([
          getCombinedPrompts(projectId),
          getCombinedPromptGroups(projectId),
        ]);
        if (cancelled) return;
        setPrompts(Array.isArray(promptsList) ? promptsList : []);
        setGroups(Array.isArray(groupsList) ? groupsList : []);
        setDataProjectId(projectId);
      } catch (err) {
        if (!cancelled) showError(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, activeProjectId, showError]);

  const handleClose = useCallback(() => {
    if (sending) return;
    onClose?.();
  }, [sending, onClose]);

  useEffect(() => {
    if (!open) return;
    function handleKey(e) {
      if (e.key === 'Escape') handleClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, handleClose]);

  const promptsCur = dataProjectId === activeProjectId
    ? prompts.filter((p) => !p.project_id || p.project_id === activeProjectId)
    : EMPTY_ARRAY;
  const groupsCur = dataProjectId === activeProjectId
    ? groups.filter((g) => g && g.project_id === activeProjectId)
    : EMPTY_ARRAY;

  const validGroupIds = useMemo(() => new Set(groupsCur.map((g) => g.id)), [groupsCur]);

  const visiblePrompts = useMemo(
    () => filterPromptsByScope(promptsCur, activeProjectId, PROMPT_SCOPE_VISIBLE),
    [promptsCur, activeProjectId],
  );

  const promptsInGroup = useMemo(
    () => filterPromptsByGroupToken(visiblePrompts, groupToken, validGroupIds),
    [visiblePrompts, groupToken, validGroupIds],
  );

  const filteredPrompts = useMemo(
    () => sortPrompts(searchPrompts(promptsInGroup, searchQuery)),
    [promptsInGroup, searchQuery],
  );

  const counts = useMemo(() => {
    const m = new Map();
    m.set(PROMPT_GROUP_ALL, visiblePrompts.length);
    m.set(PROMPT_GROUP_PINNED, visiblePrompts.filter((p) => p.pinned === true).length);
    m.set(PROMPT_GROUP_UNGROUPED, visiblePrompts.filter((p) =>
      effectivePromptGroupId(p, validGroupIds) === null
    ).length);
    for (const g of groupsCur) {
      m.set(g.id, visiblePrompts.filter((p) => effectivePromptGroupId(p, validGroupIds) === g.id).length);
    }
    return m;
  }, [visiblePrompts, groupsCur, validGroupIds]);

  async function handleCopy(prompt) {
    await copyToClipboard(prompt.body || '');
  }

  async function handleSend(prompt, sendEnter) {
    if (sending || !sessionId) return;
    const key = `${prompt.id}:${sendEnter ? '1' : '0'}`;
    setSendingKey(key);
    setSending(true);
    try {
      await sendTextToSession(sessionId, prompt.body || '', sendEnter);
      toast.success(t('prompts.sentToTerminal'));
      onClose?.();
    } catch (err) {
      showError(err);
    } finally {
      setSending(false);
      setSendingKey(null);
    }
  }

  function handleManage() {
    onClose?.();
    router.push('/prompts');
  }

  function handleBackdropClick(e) {
    if (e.target === e.currentTarget) handleClose();
  }

  if (!open) return null;

  const sidebarRows = [
    {
      token: PROMPT_GROUP_PINNED,
      label: t('prompts.pinned'),
      icon: <Pin size={13} />,
    },
    ...groupsCur.map((g) => ({
      token: g.id,
      label: g.name,
      icon: <Folder size={13} />,
    })),
    {
      token: PROMPT_GROUP_UNGROUPED,
      label: t('prompts.ungrouped'),
      icon: <FileText size={13} />,
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/60 px-4 py-6"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-card border border-border rounded-lg w-full max-w-4xl flex flex-col shadow-xl"
        style={{ height: 'min(760px, calc(100dvh - 2rem))' }}
      >
        {/* Header */}
        <div className="flex-shrink-0 px-4 sm:px-5 py-3 border-b border-border flex items-center gap-2 flex-wrap">
          <h3 className="text-foreground font-semibold text-base">
            {t('prompts.selectorTitle')}
          </h3>
          <div className="flex-1 min-w-[140px] flex items-center gap-2 rounded-md border border-border bg-input px-2 py-1.5">
            <Search size={13} className="text-muted-foreground flex-shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('prompts.searchQuickPlaceholder')}
              disabled={sending}
              autoFocus
              className="flex-1 min-w-0 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                disabled={sending}
                className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 disabled:opacity-50"
                title={t('prompts.clearSearch')}
              >
                <X size={13} />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={handleManage}
            disabled={sending}
            className="inline-flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-50"
            title={t('prompts.manage')}
          >
            <SettingsIcon size={13} />
            <span className="hidden sm:inline">{t('prompts.manage')}</span>
          </button>
          <button
            type="button"
            onClick={handleClose}
            disabled={sending}
            className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 flex">
          <div className="hidden sm:flex w-48 flex-shrink-0 flex-col bg-sidebar border-r border-sidebar-border">
            <div className="px-2 py-2 overflow-y-auto flex-1 min-h-0">
              <ul className="space-y-0.5">
                <li>
                  <button
                    type="button"
                    onClick={() => setGroupToken(PROMPT_GROUP_ALL)}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${
                      groupToken === PROMPT_GROUP_ALL
                        ? 'bg-primary/15 text-primary'
                        : 'text-foreground hover:bg-muted/40'
                    }`}
                  >
                    <span className="flex-1 min-w-0 text-left truncate">
                      {t('prompts.all')}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                      groupToken === PROMPT_GROUP_ALL ? 'text-primary/80 bg-primary/10' : 'text-muted-foreground bg-muted/40'
                    }`}>
                      {counts.get(PROMPT_GROUP_ALL) || 0}
                    </span>
                  </button>
                </li>
                {sidebarRows.map((row) => {
                  const isActive = groupToken === row.token;
                  const count = counts.get(row.token) || 0;
                  return (
                    <li key={row.token}>
                      <button
                        type="button"
                        onClick={() => setGroupToken(row.token)}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${
                          isActive ? 'bg-primary/15 text-primary' : 'text-foreground hover:bg-muted/40'
                        }`}
                      >
                        <span className={isActive ? 'text-primary' : 'text-muted-foreground'}>
                          {row.icon}
                        </span>
                        <span className="flex-1 min-w-0 text-left truncate">{row.label}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                          isActive ? 'text-primary/80 bg-primary/10' : 'text-muted-foreground bg-muted/40'
                        }`}>
                          {count}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-3">
            {loading ? (
              <div className="flex items-center justify-center py-10">
                <Loader className="w-5 h-5 text-muted-foreground animate-spin" />
              </div>
            ) : (
              <PromptList
                prompts={filteredPrompts}
                groups={groupsCur}
                onCopyPrompt={handleCopy}
                onSendPrompt={handleSend}
                sendingDisabled={sending}
                sendingKey={sendingKey}
                emptyMessage={searchQuery ? t('prompts.emptySearch') : t('prompts.emptyGroup')}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
