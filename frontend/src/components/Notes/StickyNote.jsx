'use client';

import { useState } from 'react';
import { Rnd } from 'react-rnd';
import { useNotes } from '@/providers/NotesProvider';
import { useTranslation } from '@/providers/I18nProvider';
import { MIN_WIDTH, MIN_HEIGHT } from '@/lib/notesConfig';
import { NoteHeader } from './NoteHeader';
import { NoteBody } from './NoteBody';
import { NoteEditorModal } from './NoteEditorModal';

const DRAG_HANDLE_CLASS = 'rt-note-drag-handle';

export function StickyNote({ note }) {
  const { t } = useTranslation();
  const {
    updateNoteContent, patchNoteImmediate, closeOrDeleteIfEmpty,
    deleteNote, bringToFront, getZ, savingIds,
  } = useNotes();

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  if (expanded) {
    return <NoteEditorModal note={note} fullscreen={false} onBack={() => setExpanded(false)} />;
  }

  const isSaving = !!savingIds[note.id];
  const z = getZ(note);

  return (
    <>
      <Rnd
        size={{ width: note.w, height: note.h }}
        position={{ x: note.x, y: note.y }}
        minWidth={MIN_WIDTH}
        minHeight={MIN_HEIGHT}
        bounds="window"
        dragHandleClassName={DRAG_HANDLE_CLASS}
        onDragStart={() => bringToFront(note.id)}
        onDragStop={(_e, d) => patchNoteImmediate(note.id, { x: d.x, y: d.y })}
        onResizeStop={(_e, _dir, ref, _delta, pos) => {
          patchNoteImmediate(note.id, {
            w: parseInt(ref.style.width, 10),
            h: parseInt(ref.style.height, 10),
            x: pos.x, y: pos.y,
          });
        }}
        style={{ zIndex: z }}
        className="rounded-lg shadow-[0_12px_32px_rgba(0,0,0,0.35),0_4px_12px_rgba(0,0,0,0.25)]"
      >
        <div
          className="flex h-full w-full flex-col overflow-hidden rounded-lg"
          style={{ background: `hsl(var(--note-${note.color}-bg))` }}
          onMouseDown={() => bringToFront(note.id)}
        >
          <NoteHeader
            note={note}
            dragHandleClass={DRAG_HANDLE_CLASS}
            onChangeTitle={(v) => updateNoteContent(note.id, { title: v })}
            onChangeColor={(c) => patchNoteImmediate(note.id, { color: c })}
            onTogglePin={() => patchNoteImmediate(note.id, { pinned: !note.pinned })}
            onDelete={() => setConfirmDelete(true)}
            onExpand={() => setExpanded(true)}
            onMinimize={() => closeOrDeleteIfEmpty(note.id)}
            onClose={() => closeOrDeleteIfEmpty(note.id)}
          />
          <NoteBody
            value={note.content}
            color={note.color}
            onChange={(v) => updateNoteContent(note.id, { content: v })}
          />
          <footer
            className="flex items-center justify-between border-t px-2.5 py-1 text-[10.5px]"
            style={{
              color: `hsl(var(--note-${note.color}-fg))`,
              opacity: 0.6,
              borderColor: 'rgba(0,0,0,0.08)',
            }}
          >
            <span>{isSaving ? t('notes.status.saving') : t('notes.status.saved')}</span>
          </footer>
        </div>
      </Rnd>
      {confirmDelete && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          style={{ background: 'hsl(var(--overlay) / 0.6)' }}
          onClick={() => { if (!isDeleting) setConfirmDelete(false); }}
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
                onClick={() => setConfirmDelete(false)}
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
                  setIsDeleting(true);
                  try { await deleteNote(note.id); }
                  finally { setIsDeleting(false); setConfirmDelete(false); }
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
