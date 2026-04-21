'use client';

import { NOTE_COLORS } from '@/lib/notesConfig';

export function ColorPalette({ value, onChange }) {
  return (
    <div
      className="flex flex-wrap gap-1 rounded-md border p-1.5 shadow-lg"
      style={{ background: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }}
      onClick={(e) => e.stopPropagation()}
    >
      {NOTE_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          className="h-5 w-5 rounded-sm border"
          style={{
            background: `hsl(var(--note-${c}-bg))`,
            borderColor: c === value ? 'hsl(var(--primary))' : 'rgba(0,0,0,0.15)',
            outline: c === value ? '2px solid hsl(var(--primary))' : 'none',
            outlineOffset: '1px',
          }}
          onClick={() => onChange(c)}
          aria-label={c}
        />
      ))}
    </div>
  );
}
