'use client';

import { useState } from 'react';
import { ArrowLeft, Trash2, X } from 'lucide-react';
import { useTranslation } from '@/providers/I18nProvider';
import { useNotes } from '@/providers/NotesProvider';
import { NOTE_COLORS, isNoteEmpty } from '@/lib/notesConfig';

export function NoteEditorModal({ note, onBack, fullscreen = true }) {
  const { t } = useTranslation();
  const { updateNoteContent, patchNoteImmediate, deleteNote, savingIds } = useNotes();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  function handleBack() {
    if (isNoteEmpty(note)) {
      deleteNote(note.id);
    }
    onBack();
  }

  const body = (
    <>
      <header
        className="flex items-center gap-2 px-3 py-2"
        style={{ background: `hsl(var(--note-${note.color}-header))` }}
      >
        <button
          type="button"
          className="rounded p-1.5 hover:bg-black/10"
          onClick={handleBack}
          title={fullscreen ? t('notes.fullscreen.back') : t('notes.action.close')}
        >
          {fullscreen ? <ArrowLeft size={18} /> : <X size={18} />}
        </button>
        <input
          value={note.title}
          onChange={(e) => updateNoteContent(note.id, { title: e.target.value })}
          placeholder={t('notes.fullscreen.titlePlaceholder')}
          className="flex-1 border-none bg-transparent px-1 text-base font-semibold outline-none"
          style={{ color: 'inherit' }}
        />
        <button
          type="button"
          className="rounded p-1.5 hover:bg-black/10"
          onClick={() => setConfirmDelete(true)}
          title={t('notes.action.delete')}
        >
          <Trash2 size={18} />
        </button>
      </header>
      <textarea
        value={note.content}
        onChange={(e) => updateNoteContent(note.id, { content: e.target.value })}
        placeholder={t('notes.fullscreen.bodyPlaceholder')}
        spellCheck={false}
        className="flex-1 min-h-0 resize-none border-none bg-transparent px-4 py-3 text-base outline-none"
        style={{ color: 'inherit', lineHeight: 1.5 }}
      />
      <footer
        className="flex items-center gap-2 border-t px-3 py-2 text-xs"
        style={{ borderColor: 'rgba(0,0,0,0.1)' }}
      >
        <div className="flex flex-wrap gap-1">
          {NOTE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className="h-5 w-5 rounded border"
              style={{
                background: `hsl(var(--note-${c}-header))`,
                borderColor: 'rgba(0,0,0,0.15)',
                outline: c === note.color ? '2px solid currentColor' : 'none',
                outlineOffset: '1px',
              }}
              onClick={() => patchNoteImmediate(note.id, { color: c })}
              aria-label={c}
            />
          ))}
        </div>
        <span className="ml-auto" style={{ opacity: 0.6 }}>
          {savingIds[note.id] ? t('notes.status.saving') : t('notes.status.saved')}
        </span>
      </footer>

      {confirmDelete && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          style={{ background: 'hsl(var(--overlay) / 0.6)' }}
          onClick={() => { if (!isDeleting) setConfirmDelete(false); }}
        >
          <div
            className="w-full max-w-sm rounded-lg border p-4"
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
                  try {
                    await deleteNote(note.id);
                    setConfirmDelete(false);
                    onBack();
                  } finally {
                    setIsDeleting(false);
                  }
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

  if (fullscreen) {
    return (
      <div
        className="fixed inset-0 z-[9500] flex flex-col"
        style={{
          background: `hsl(var(--note-${note.color}-bg))`,
          color: `hsl(var(--note-${note.color}-fg))`,
        }}
      >
        {body}
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[9500] flex items-center justify-center p-4"
      style={{ background: 'hsl(var(--overlay) / 0.6)' }}
      onClick={handleBack}
    >
      <div
        className="flex w-full max-w-3xl flex-col overflow-hidden rounded-lg border shadow-2xl"
        style={{
          maxHeight: '85vh',
          minHeight: '60vh',
          background: `hsl(var(--note-${note.color}-bg))`,
          color: `hsl(var(--note-${note.color}-fg))`,
          borderColor: 'hsl(var(--border))',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {body}
      </div>
    </div>
  );
}
