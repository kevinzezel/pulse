'use client';

import { useState, useEffect, useRef } from 'react';
import {
  ArrowLeft, Pin, Globe, FileText, Copy, Send, Pencil, Check, Loader, X,
} from 'lucide-react';
import { useTranslation } from '@/providers/I18nProvider';
import { getPromptGroupName } from './promptUtils';

// Modes:
// - 'preview': showing details of an existing prompt
// - 'edit':    editing an existing prompt
// - 'create':  building a new prompt from scratch
// - 'empty':   no prompt selected
export default function PromptEditorPanel({
  mode = 'empty',
  prompt = null,
  groups = [],
  defaultIsGlobal = false,
  defaultGroupId = null,
  defaultPinned = false,
  onEnterEdit,
  onCancel,
  onBack,
  onSave,
  onCopy,
  onSend,
  saving = false,
  emptyHint,
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [isGlobal, setIsGlobal] = useState(false);
  const [groupId, setGroupId] = useState(null);
  const [pinned, setPinned] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef(null);

  useEffect(() => {
    if (mode === 'edit' && prompt) {
      setName(prompt.name || '');
      setBody(prompt.body || '');
      setIsGlobal(!prompt.project_id);
      setGroupId(prompt.project_id ? (prompt.group_id || null) : null);
      setPinned(prompt.pinned === true);
    } else if (mode === 'create') {
      setName('');
      setBody('');
      setIsGlobal(defaultIsGlobal);
      setGroupId(defaultIsGlobal ? null : defaultGroupId);
      setPinned(defaultPinned);
    }
  }, [mode, prompt, defaultIsGlobal, defaultGroupId, defaultPinned]);

  useEffect(() => {
    if (isGlobal && groupId) setGroupId(null);
  }, [isGlobal, groupId]);

  useEffect(() => {
    setCopied(false);
    if (copiedTimerRef.current) {
      clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = null;
    }
  }, [mode, prompt?.id]);

  function handleSubmit(e) {
    e.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) return;
    onSave?.({
      name: cleanName,
      body,
      isGlobal,
      groupId: isGlobal ? null : (groupId || null),
      pinned,
    });
  }

  async function handleCopyClick() {
    if (!prompt || !onCopy) return;
    await onCopy(prompt);
    setCopied(true);
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => {
      setCopied(false);
      copiedTimerRef.current = null;
    }, 2000);
  }

  if (mode === 'empty') {
    return (
      <div className="flex flex-col h-full items-center justify-center text-center p-6 text-muted-foreground">
        <FileText size={32} className="mb-3 opacity-60" />
        <p className="text-sm max-w-xs">{emptyHint || t('prompts.selectPrompt')}</p>
      </div>
    );
  }

  if (mode === 'preview' && prompt) {
    const isGlobalView = !prompt.project_id;
    const groupName = getPromptGroupName(prompt.group_id, groups, t);
    return (
      <div className="flex flex-col h-full min-h-0">
        <div className="px-4 pt-4 pb-3 border-b border-border flex items-start gap-3 flex-shrink-0">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="p-2 -ml-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors flex-shrink-0"
              title={t('common.back')}
              aria-label={t('common.back')}
            >
              <ArrowLeft size={18} />
            </button>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {prompt.pinned && <Pin size={14} className="text-primary" />}
              <h3 className="text-base font-semibold text-foreground truncate">
                {prompt.name}
              </h3>
            </div>
            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
              {isGlobalView ? (
                <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary font-medium">
                  <Globe size={10} />
                  {t('prompts.scopeGlobal')}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-muted/40 text-muted-foreground font-medium">
                  <FileText size={10} />
                  {t('prompts.projectBadge')}
                </span>
              )}
              {!isGlobalView && prompt.group_id && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted/40 text-muted-foreground">
                  {groupName}
                </span>
              )}
              {prompt.pinned && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">
                  {t('prompts.pinnedBadge')}
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onEnterEdit}
            className="p-2 rounded-md text-muted-foreground hover:text-primary hover:bg-muted/40 transition-colors flex-shrink-0"
            title={t('prompts.edit')}
          >
            <Pencil size={14} />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          {prompt.body ? (
            <pre className="text-sm text-foreground bg-muted/20 rounded-md p-3 whitespace-pre-wrap break-words font-mono">
              {prompt.body}
            </pre>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              {t('prompts.editorPreview')}
            </p>
          )}
        </div>
        <div className="px-4 py-3 border-t border-border flex flex-wrap gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={handleCopyClick}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm border transition-colors ${
              copied
                ? 'border-success/40 bg-success/10 text-success'
                : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted/40'
            }`}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? t('prompts.copied') : t('prompts.copy')}
          </button>
          {onSend && (
            <button
              type="button"
              onClick={() => onSend(prompt)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium text-white bg-brand-gradient hover:opacity-90 transition-opacity"
            >
              <Send size={13} />
              {t('prompts.send')}
            </button>
          )}
        </div>
      </div>
    );
  }

  // edit / create
  return (
    <form onSubmit={handleSubmit} className="flex flex-col h-full min-h-0">
      <div className="px-4 pt-4 pb-3 border-b border-border flex items-center justify-between flex-shrink-0">
        <h3 className="text-base font-semibold text-foreground">
          {mode === 'create' ? t('prompts.newTitle') : t('prompts.editTitle')}
        </h3>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
          title={t('common.cancel')}
        >
          <X size={16} />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">{t('prompts.nameLabel')}</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('prompts.namePlaceholder')}
            maxLength={50}
            autoFocus
            disabled={saving}
            className="px-3 py-2 rounded-md bg-input border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="flex flex-col gap-1 flex-1 min-h-0">
          <label className="text-xs text-muted-foreground">{t('prompts.bodyLabel')}</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t('prompts.bodyPlaceholder')}
            disabled={saving}
            spellCheck={false}
            className="flex-1 min-h-[200px] px-3 py-2 rounded-md bg-input border border-border text-sm text-foreground font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
          />
        </div>
        {!isGlobal && (
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">{t('prompts.groupLabel')}</label>
            <select
              value={groupId || ''}
              onChange={(e) => setGroupId(e.target.value || null)}
              disabled={saving}
              className="px-3 py-2 rounded-md bg-input border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">{t('prompts.noGroup')}</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </div>
        )}
        <label className="flex items-start gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={isGlobal}
            onChange={(e) => {
              const checked = e.target.checked;
              setIsGlobal(checked);
              if (checked) setGroupId(null);
            }}
            disabled={saving}
            className="mt-0.5 accent-primary"
          />
          <span className="flex flex-col">
            <span className="text-sm text-foreground">{t('prompts.makeGlobal')}</span>
            <span className="text-xs text-muted-foreground">{t('prompts.makeGlobalHelp')}</span>
          </span>
        </label>
        <label className="flex items-start gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={pinned}
            onChange={(e) => setPinned(e.target.checked)}
            disabled={saving}
            className="mt-0.5 accent-primary"
          />
          <span className="flex flex-col">
            <span className="text-sm text-foreground">{t('prompts.pin')}</span>
          </span>
        </label>
      </div>
      <div className="px-4 py-3 border-t border-border flex gap-2 flex-shrink-0">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="flex-1 py-2 rounded-md text-sm font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-50"
        >
          {t('common.cancel')}
        </button>
        <button
          type="submit"
          disabled={saving || !name.trim()}
          className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 rounded-md text-sm font-medium text-white bg-brand-gradient hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {saving ? <Loader size={14} className="animate-spin" /> : <Check size={14} />}
          {saving ? t('prompts.saving') : t('prompts.save')}
        </button>
      </div>
    </form>
  );
}
