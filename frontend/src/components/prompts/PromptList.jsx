'use client';

import { useState } from 'react';
import {
  Pin, Globe, FileText, Copy, Send, CornerDownLeft, Pencil, Trash2, Check, Loader,
} from 'lucide-react';
import { useTranslation } from '@/providers/I18nProvider';
import { getPromptGroupName } from './promptUtils';

function bodyPreview(body) {
  if (!body) return '';
  const lines = body.split('\n').slice(0, 3).join('\n');
  if (lines.length > 200) return lines.slice(0, 200) + '…';
  return lines;
}

export default function PromptList({
  prompts = [],
  groups = [],
  selectedPromptId = null,
  onSelectPrompt,
  onEditPrompt,
  onDeletePrompt,
  onCopyPrompt,
  onSendPrompt,
  emptyMessage,
  loading = false,
  sendingDisabled = false,
  sendingKey = null,
  sendMode = 'dual',
}) {
  const { t } = useTranslation();
  const [copiedId, setCopiedId] = useState(null);

  async function handleCopy(prompt, e) {
    e.stopPropagation();
    try {
      await onCopyPrompt(prompt);
      setCopiedId(prompt.id);
      setTimeout(() => setCopiedId((cur) => (cur === prompt.id ? null : cur)), 2000);
    } catch {}
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader className="w-5 h-5 text-muted-foreground animate-spin" />
      </div>
    );
  }

  if (prompts.length === 0) {
    return (
      <div className="py-10 text-center text-muted-foreground text-sm">
        {emptyMessage}
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {prompts.map((prompt) => {
        const isSelected = selectedPromptId === prompt.id;
        const isGlobal = !prompt.project_id;
        const groupName = getPromptGroupName(prompt.group_id, groups, t);
        const isCopied = copiedId === prompt.id;
        const sendingOnly = sendingKey === `${prompt.id}:0`;
        const sendingEnter = sendingKey === `${prompt.id}:1`;

        return (
          <li
            key={prompt.id}
            onClick={() => onSelectPrompt?.(prompt)}
            className={`p-3 rounded-md border transition-colors cursor-pointer ${
              isSelected
                ? 'border-primary/60 bg-primary/5'
                : 'border-border bg-card hover:bg-muted/30'
            }`}
          >
            <div className="flex items-start gap-2 mb-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {prompt.pinned && (
                    <Pin size={12} className="text-primary flex-shrink-0" />
                  )}
                  <span className="text-sm font-medium text-foreground truncate">
                    {prompt.name}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  {isGlobal ? (
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
                  {prompt.group_id && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted/40 text-muted-foreground">
                      {groupName}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex gap-0.5 flex-shrink-0">
                <button
                  type="button"
                  onClick={(e) => handleCopy(prompt, e)}
                  className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                  title={t('prompts.copy')}
                >
                  {isCopied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
                </button>
                {onSendPrompt && (
                  sendMode === 'single' ? (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onSendPrompt(prompt, false); }}
                      disabled={sendingDisabled}
                      className="p-1.5 rounded text-muted-foreground hover:text-primary hover:bg-muted/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title={t('prompts.send')}
                    >
                      {sendingOnly ? <Loader size={13} className="animate-spin" /> : <Send size={13} />}
                    </button>
                  ) : (
                    <>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onSendPrompt(prompt, false); }}
                      disabled={sendingDisabled}
                      className="p-1.5 rounded text-muted-foreground hover:text-primary hover:bg-muted/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title={t('prompts.sendOnly')}
                    >
                      {sendingOnly ? <Loader size={13} className="animate-spin" /> : <Send size={13} />}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onSendPrompt(prompt, true); }}
                      disabled={sendingDisabled}
                      className="p-1.5 rounded text-muted-foreground hover:text-primary hover:bg-muted/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title={t('prompts.sendEnter')}
                    >
                      {sendingEnter ? <Loader size={13} className="animate-spin" /> : <CornerDownLeft size={13} />}
                    </button>
                    </>
                  )
                )}
                {onEditPrompt && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onEditPrompt(prompt); }}
                    className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                    title={t('prompts.edit')}
                  >
                    <Pencil size={13} />
                  </button>
                )}
                {onDeletePrompt && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onDeletePrompt(prompt); }}
                    className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-muted/40 transition-colors"
                    title={t('prompts.delete')}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            </div>
            {prompt.body && (
              <pre className="text-xs text-muted-foreground bg-muted/30 rounded px-2 py-1.5 whitespace-pre-wrap break-words font-mono max-h-20 overflow-hidden">
                {bodyPreview(prompt.body)}
              </pre>
            )}
          </li>
        );
      })}
    </ul>
  );
}
