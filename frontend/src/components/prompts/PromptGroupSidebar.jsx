'use client';

import { useState, useRef, useEffect } from 'react';
import {
  Folder, FolderOpen, Pin, FileText, Plus, Pencil, Trash2, X, Loader, Check,
} from 'lucide-react';
import { useTranslation } from '@/providers/I18nProvider';
import {
  PROMPT_GROUP_ALL,
  PROMPT_GROUP_PINNED,
  PROMPT_GROUP_UNGROUPED,
} from './promptConstants';

export default function PromptGroupSidebar({
  groups = [],
  counts,
  selectedGroupToken,
  onSelectGroup,
  onCreateGroup,
  onRenameGroup,
  onDeleteGroup,
  creating = false,
  renamingId = null,
  deletingId = null,
}) {
  const { t } = useTranslation();
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const createInputRef = useRef(null);
  const editInputRef = useRef(null);

  useEffect(() => {
    if (createOpen) {
      const id = setTimeout(() => createInputRef.current?.focus(), 30);
      return () => clearTimeout(id);
    }
    if (editingId) {
      const id = setTimeout(() => editInputRef.current?.focus(), 30);
      return () => clearTimeout(id);
    }
  }, [createOpen, editingId]);

  function handleCreateSubmit(e) {
    e.preventDefault();
    const name = createName.trim();
    if (!name) return;
    onCreateGroup(name).then(() => {
      setCreateName('');
      setCreateOpen(false);
    }).catch(() => {});
  }

  function handleEditSubmit(e) {
    e.preventDefault();
    const name = editName.trim();
    if (!name) return;
    onRenameGroup(editingId, name).then(() => {
      setEditingId(null);
      setEditName('');
    }).catch(() => {});
  }

  function startEdit(group) {
    setEditingId(group.id);
    setEditName(group.name);
  }

  function handleConfirmDelete() {
    if (!confirmDeleteId) return;
    onDeleteGroup(confirmDeleteId).then(() => {
      setConfirmDeleteId(null);
    }).catch(() => {});
  }

  const virtualEntries = [
    {
      token: PROMPT_GROUP_ALL,
      label: t('prompts.all'),
      icon: <FolderOpen size={14} className="text-muted-foreground" />,
    },
    {
      token: PROMPT_GROUP_PINNED,
      label: t('prompts.pinned'),
      icon: <Pin size={14} className="text-muted-foreground" />,
    },
  ];

  function renderRow({ token, label, icon, group }) {
    const isActive = selectedGroupToken === token;
    const isEditing = editingId && group && editingId === group.id;
    const isDeleting = deletingId === (group?.id || null);
    const count = counts ? counts.get(token) || 0 : 0;

    if (isEditing) {
      return (
        <li key={token}>
          <form onSubmit={handleEditSubmit} className="flex items-center gap-1 px-2 py-1.5">
            <input
              ref={editInputRef}
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              maxLength={50}
              disabled={renamingId === group.id}
              className="flex-1 min-w-0 px-2 py-1 rounded bg-input border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              type="submit"
              disabled={renamingId === group.id || !editName.trim()}
              className="p-1 rounded text-success hover:bg-muted/40 disabled:opacity-50"
              title={t('prompts.save')}
            >
              {renamingId === group.id ? <Loader size={14} className="animate-spin" /> : <Check size={14} />}
            </button>
            <button
              type="button"
              onClick={() => { setEditingId(null); setEditName(''); }}
              disabled={renamingId === group.id}
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/40 disabled:opacity-50"
              title={t('common.cancel')}
            >
              <X size={14} />
            </button>
          </form>
        </li>
      );
    }

    return (
      <li key={token}>
        <div
          role="button"
          tabIndex={0}
          onClick={() => onSelectGroup(token)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelectGroup(token);
            }
          }}
          className={`group flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer text-sm transition-colors ${
            isActive
              ? 'bg-primary/15 text-primary'
              : 'text-foreground hover:bg-muted/40'
          }`}
        >
          {icon}
          <span className="flex-1 min-w-0 truncate">{label}</span>
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded ${
              isActive ? 'text-primary/80 bg-primary/10' : 'text-muted-foreground bg-muted/40'
            }`}
          >
            {count}
          </span>
          {group && (
            <>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); startEdit(group); }}
                className="opacity-0 group-hover:opacity-100 p-1 rounded text-muted-foreground hover:text-primary hover:bg-muted/60 transition-opacity"
                title={t('prompts.renameGroup')}
              >
                <Pencil size={11} />
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(group.id); }}
                disabled={isDeleting}
                className="opacity-0 group-hover:opacity-100 p-1 rounded text-muted-foreground hover:text-destructive hover:bg-muted/60 transition-opacity disabled:opacity-50"
                title={t('prompts.deleteGroup')}
              >
                {isDeleting ? <Loader size={11} className="animate-spin" /> : <Trash2 size={11} />}
              </button>
            </>
          )}
        </div>
      </li>
    );
  }

  const deleteTarget = confirmDeleteId ? groups.find((g) => g.id === confirmDeleteId) : null;
  const deleteCount = deleteTarget && counts ? (counts.get(deleteTarget.id) || 0) : 0;

  return (
    <div className="flex flex-col h-full min-h-0 bg-sidebar border-r border-sidebar-border">
      <div className="px-3 pt-3 pb-2 flex items-center justify-between flex-shrink-0">
        <h2 className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
          {t('prompts.groupLabel')}
        </h2>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          title={t('prompts.newGroup')}
          aria-label={t('prompts.newGroup')}
          className="p-1 rounded text-muted-foreground hover:text-primary hover:bg-muted/40 transition-colors"
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-3">
        <ul className="space-y-0.5">
          {virtualEntries.map((entry) => renderRow(entry))}
          {groups.length > 0 && (
            <li className="pt-2 pb-1 px-2 text-[10px] uppercase tracking-wide text-muted-foreground/70 font-semibold">
              {t('prompts.groupLabel')}
            </li>
          )}
          {groups.map((g) => renderRow({
            token: g.id,
            label: g.name,
            icon: <Folder size={14} className="text-muted-foreground" />,
            group: g,
          }))}
          <li className="pt-2 pb-1 px-2 text-[10px] uppercase tracking-wide text-muted-foreground/70 font-semibold">
            {t('prompts.noGroup')}
          </li>
          {renderRow({
            token: PROMPT_GROUP_UNGROUPED,
            label: t('prompts.ungrouped'),
            icon: <FileText size={14} className="text-muted-foreground" />,
          })}
        </ul>

        {createOpen && (
          <form
            onSubmit={handleCreateSubmit}
            className="mt-3 mx-1 p-2 rounded-md border border-border bg-card"
          >
            <input
              ref={createInputRef}
              type="text"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder={t('prompts.newGroup')}
              maxLength={50}
              disabled={creating}
              className="w-full px-2 py-1 rounded bg-input border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <div className="flex gap-1 mt-2">
              <button
                type="submit"
                disabled={creating || !createName.trim()}
                className="flex-1 inline-flex items-center justify-center gap-1 py-1.5 rounded text-xs font-medium text-white bg-brand-gradient hover:opacity-90 disabled:opacity-50"
              >
                {creating ? <Loader size={12} className="animate-spin" /> : <Check size={12} />}
                {t('prompts.save')}
              </button>
              <button
                type="button"
                onClick={() => { setCreateOpen(false); setCreateName(''); }}
                disabled={creating}
                className="px-2 py-1.5 rounded text-xs border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 disabled:opacity-50"
              >
                {t('common.cancel')}
              </button>
            </div>
          </form>
        )}
      </div>

      {deleteTarget && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-overlay/60 px-4">
          <div className="bg-card border border-border rounded-lg p-6 w-full max-w-sm">
            <h3 className="text-foreground font-semibold mb-2">
              {t('prompts.deleteGroupConfirmTitle')}
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              <span className="text-foreground font-medium">{deleteTarget.name}</span>
              {' — '}
              {t('prompts.deleteGroupConfirmMessage', { n: deleteCount })}
            </p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setConfirmDeleteId(null)}
                disabled={deletingId === deleteTarget.id}
                className="px-3 py-1.5 rounded text-sm border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 disabled:opacity-50"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={deletingId === deleteTarget.id}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded text-sm font-medium text-white bg-destructive hover:bg-destructive/80 disabled:opacity-50"
              >
                {deletingId === deleteTarget.id && <Loader size={12} className="animate-spin" />}
                {t('prompts.deleteGroup')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
