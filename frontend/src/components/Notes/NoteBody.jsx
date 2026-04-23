'use client';

import { useTranslation } from '@/providers/I18nProvider';

export function NoteBody({ value, onChange, color }) {
  const { t } = useTranslation();

  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={t('notes.bodyPlaceholder')}
      spellCheck={false}
      className="flex-1 resize-none border-none bg-transparent px-3 py-2.5 text-sm outline-none"
      style={{ color: `hsl(var(--note-${color}-fg))`, fontFamily: 'inherit', lineHeight: 1.5 }}
    />
  );
}
