'use client';

import { useState } from 'react';
import { X, Plus, Pin, Search, Trash2, Palette, Maximize2 } from 'lucide-react';
import { useTranslation } from '@/providers/I18nProvider';
import { useNotes } from '@/providers/NotesProvider';
import { useIsMobile } from '@/hooks/layout';
import { ColorPalette } from './ColorPalette';
import { NoteEditorModal } from './NoteEditorModal';

export function NotesManager() {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const {
    managerOpen, setManagerOpen,
    notes, filtered,
    search, setSearch,
    createNote, deleteNote, patchNoteImmediate,
  } = useNotes();

  const [expandedNoteId, setExpandedNoteId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const pinned = filtered.filter((n) => n.pinned);
  const open = filtered.filter((n) => !n.pinned && n.open);
  const closed = filtered.filter((n) => !n.pinned && !n.open);

  if (!managerOpen) return null;

  const expandedNote = expandedNoteId ? notes.find((n) => n.id === expandedNoteId) : null;
  const toDelete = confirmDeleteId ? notes.find((n) => n.id === confirmDeleteId) : null;

  function NoteItem({ n }) {
    const [activePopover, setActivePopover] = useState(null);
    const preview = n.content ? n.content.split('\n').slice(0, 2).join(' · ') : t('notes.manager.emptyPreview');

    function handleItemClick() {
      if (activePopover) { setActivePopover(null); return; }
      if (isMobile) setExpandedNoteId(n.id);
      else if (!n.open) patchNoteImmediate(n.id, { open: true });
    }

    const actionsVisibleClass = activePopover ? 'opacity-100' : 'opacity-0 group-hover:opacity-100';

    return (
      <li
        className="group relative mb-1 flex cursor-pointer gap-2.5 rounded-md p-2.5 hover:bg-muted"
        style={n.open && !isMobile ? { outline: '1px solid hsl(var(--primary) / 0.35)', background: 'hsl(var(--primary) / 0.05)' } : undefined}
        onClick={handleItemClick}
      >
        <div className="w-1.5 rounded-sm" style={{ background: 'hsl(var(--muted-foreground))' }} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 font-medium truncate">
            {n.pinned && <Pin size={11} className="text-yellow-500" fill="currentColor" />}
            <span className="truncate">{n.title || t('notes.titlePlaceholder')}</span>
          </div>
          <div className="line-clamp-2 text-xs text-muted-foreground">{preview}</div>
          {!n.open && !isMobile && (
            <div className="mt-1.5 flex items-center gap-2 text-[10.5px] text-muted-foreground">
              <span className="italic opacity-70">{t('notes.manager.minimizedBadge')}</span>
            </div>
          )}
        </div>

        {!isMobile && (
          <div
            className={`flex gap-0.5 self-start transition-opacity ${actionsVisibleClass}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative">
              <button
                type="button"
                className="rounded p-1 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                title={t('notes.action.color')}
                onClick={() => setActivePopover((p) => (p === 'color' ? null : 'color'))}
              >
                <Palette size={14} />
              </button>
              {activePopover === 'color' && (
                <div className="absolute right-0 top-full z-30 mt-1">
                  <ColorPalette
                    value={n.color}
                    onChange={(c) => { patchNoteImmediate(n.id, { color: c }); setActivePopover(null); }}
                  />
                </div>
              )}
            </div>

            <button
              type="button"
              className="rounded p-1 hover:bg-muted/60"
              style={{ color: n.pinned ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))' }}
              title={n.pinned ? t('notes.action.unpin') : t('notes.action.pin')}
              onClick={() => patchNoteImmediate(n.id, { pinned: !n.pinned })}
            >
              <Pin size={14} fill={n.pinned ? 'currentColor' : 'none'} />
            </button>
            <button
              type="button"
              className="rounded p-1 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              title={t('notes.action.expand')}
              onClick={() => setExpandedNoteId(n.id)}
            >
              <Maximize2 size={14} />
            </button>
            <button
              type="button"
              className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              title={t('notes.action.delete')}
              onClick={() => setConfirmDeleteId(n.id)}
            >
              <Trash2 size={14} />
            </button>
          </div>
        )}

        {activePopover && (
          <div
            className="fixed inset-0 z-20"
            onClick={(e) => { e.stopPropagation(); setActivePopover(null); }}
          />
        )}
      </li>
    );
  }

  const drawerClasses = isMobile
    ? 'fixed inset-0 z-[9000] flex flex-col'
    : 'fixed right-0 top-0 bottom-0 z-[8000] flex w-1/4 min-w-[340px] flex-col border-l shadow-2xl';

  return (
    <>
      <aside
        className={drawerClasses}
        style={{ background: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', color: 'hsl(var(--foreground))' }}
      >
        <header className="flex items-center justify-between border-b px-4 py-3.5" style={{ borderColor: 'hsl(var(--border))' }}>
          <h2 className="text-[15px] font-semibold">{t('notes.manager.title')}</h2>
          <button type="button" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => setManagerOpen(false)} title={t('notes.manager.close')}>
            <X size={18} />
          </button>
        </header>

        <div className="px-4 pt-3">
          <div className="relative">
            <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('notes.manager.search')}
              className="w-full rounded-md border bg-input py-1.5 pl-8 pr-2 text-sm outline-none focus:border-primary"
              style={{ borderColor: 'hsl(var(--border))' }}
            />
          </div>
        </div>

        <div className="flex gap-2 px-4 py-2.5">
          <button
            type="button"
            disabled={isCreating}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-brand-gradient px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
            onClick={async () => {
              if (isCreating) return;
              setIsCreating(true);
              try { await createNote(); }
              finally { setIsCreating(false); }
            }}
          >
            <Plus size={14} /> {t('notes.manager.new')}
          </button>
        </div>

        <ul className="flex-1 overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <li className="p-4 text-center text-sm text-muted-foreground">
              {search.trim() ? t('notes.manager.emptyFiltered') : t('notes.manager.empty')}
            </li>
          ) : (
            <>
              {pinned.length > 0 && (
                <>
                  <SectionLabel>{t('notes.manager.pinnedSection')}</SectionLabel>
                  {pinned.map((n) => <NoteItem key={n.id} n={n} />)}
                </>
              )}
              {open.length > 0 && (
                <>
                  {pinned.length > 0 && <SectionLabel>{t('notes.manager.openSection')}</SectionLabel>}
                  {open.map((n) => <NoteItem key={n.id} n={n} />)}
                </>
              )}
              {closed.length > 0 && (
                <>
                  <SectionLabel>{t('notes.manager.closedSection')}</SectionLabel>
                  {closed.map((n) => <NoteItem key={n.id} n={n} />)}
                </>
              )}
            </>
          )}
        </ul>
      </aside>

      {expandedNote && (
        <NoteEditorModal
          note={expandedNote}
          fullscreen={isMobile}
          onBack={() => setExpandedNoteId(null)}
        />
      )}

      {toDelete && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          style={{ background: 'hsl(var(--overlay) / 0.6)' }}
          onClick={() => { if (!isDeleting) setConfirmDeleteId(null); }}
        >
          <div
            className="w-full max-w-sm rounded-lg border p-4 shadow-xl"
            style={{ background: 'hsl(var(--card))', color: 'hsl(var(--foreground))', borderColor: 'hsl(var(--border))' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-2 text-sm font-semibold">{t('notes.confirmDelete.title')}</h3>
            <p className="mb-4 text-xs text-muted-foreground">{t('notes.confirmDelete.message')}</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={isDeleting}
                className="rounded px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-60 disabled:cursor-not-allowed"
                onClick={() => setConfirmDeleteId(null)}
              >
                {t('notes.confirmDelete.cancel')}
              </button>
              <button
                type="button"
                disabled={isDeleting}
                className="rounded px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60 disabled:cursor-not-allowed"
                style={{ background: 'hsl(var(--destructive))' }}
                onClick={async () => {
                  if (isDeleting) return;
                  const id = toDelete.id;
                  setIsDeleting(true);
                  try { await deleteNote(id); }
                  finally { setIsDeleting(false); setConfirmDeleteId(null); }
                }}
              >
                {t('notes.confirmDelete.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function SectionLabel({ children }) {
  return (
    <li className="px-2 pt-2 pb-1 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </li>
  );
}
