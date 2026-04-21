'use client';

import { StickyNote as IconNote } from 'lucide-react';
import { useTranslation } from '@/providers/I18nProvider';
import { useNotes } from '@/providers/NotesProvider';

export default function NotesHeaderButton() {
  const { t } = useTranslation();
  const { setManagerOpen, openNotes } = useNotes();
  const badge = openNotes.length > 0 ? openNotes.length : null;

  return (
    <button
      type="button"
      onClick={() => setManagerOpen(true)}
      className="relative p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
      title={t('notes.fab')}
      aria-label={t('notes.fab')}
    >
      <IconNote size={18} />
      {badge !== null && (
        <span
          className="absolute -top-0.5 -right-0.5 flex min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none pointer-events-none"
          style={{
            height: 16,
            background: 'hsl(var(--destructive))',
            color: 'white',
          }}
        >
          {badge}
        </span>
      )}
    </button>
  );
}
