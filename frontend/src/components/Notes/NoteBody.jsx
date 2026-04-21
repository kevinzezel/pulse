'use client';

import { useRef, useState, useEffect } from 'react';
import { useTranslation } from '@/providers/I18nProvider';

export function NoteBody({ value, onChange, color }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const textareaRef = useRef(null);

  useEffect(() => {
    if (editing && textareaRef.current) textareaRef.current.focus();
  }, [editing]);

  function toggleCheckbox(lineIndex) {
    const lines = value.split('\n');
    const line = lines[lineIndex];
    if (!line) return;
    const m = line.match(/^(\s*)\[( |x|X)\](\s.*)?$/);
    if (!m) return;
    const [, lead, mark, rest] = m;
    const newMark = mark === ' ' ? 'x' : ' ';
    lines[lineIndex] = `${lead}[${newMark}]${rest ?? ''}`;
    onChange(lines.join('\n'));
  }

  if (editing) {
    return (
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setEditing(false)}
        placeholder={t('notes.bodyPlaceholder')}
        spellCheck={false}
        className="flex-1 resize-none border-none bg-transparent px-3 py-2.5 text-sm outline-none"
        style={{ color: `hsl(var(--note-${color}-fg))`, fontFamily: 'inherit', lineHeight: 1.5 }}
      />
    );
  }

  const lines = value.split('\n');
  return (
    <div
      className="flex-1 cursor-text overflow-auto whitespace-pre-wrap px-3 py-2.5 text-sm"
      style={{ color: `hsl(var(--note-${color}-fg))`, lineHeight: 1.5 }}
      onClick={() => setEditing(true)}
    >
      {value === '' && (
        <span style={{ opacity: 0.4 }}>{t('notes.bodyPlaceholder')}</span>
      )}
      {lines.map((line, i) => {
        const m = line.match(/^(\s*)\[( |x|X)\](\s.*)?$/);
        if (m) {
          const checked = m[2].toLowerCase() === 'x';
          return (
            <div key={i} className="flex items-start gap-1.5">
              <span style={{ whiteSpace: 'pre' }}>{m[1]}</span>
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => { e.stopPropagation(); }}
                onClick={(e) => { e.stopPropagation(); toggleCheckbox(i); }}
                className="mt-0.5"
              />
              <span style={{ textDecoration: checked ? 'line-through' : 'none', opacity: checked ? 0.6 : 1 }}>
                {m[3]?.trimStart() ?? ''}
              </span>
            </div>
          );
        }
        return <div key={i}>{line || ' '}</div>;
      })}
    </div>
  );
}
