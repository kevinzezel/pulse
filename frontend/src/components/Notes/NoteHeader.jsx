'use client';

import { useState } from 'react';
import { Palette, Pin, Minus, X, Trash2, Maximize2, GripVertical } from 'lucide-react';
import { useTranslation } from '@/providers/I18nProvider';
import { ColorPalette } from './ColorPalette';

export function NoteHeader({
  note, onChangeTitle, onChangeColor,
  onTogglePin, onMinimize, onClose, onDelete, onExpand,
  dragHandleClass,
}) {
  const { t } = useTranslation();
  const [paletteOpen, setPaletteOpen] = useState(false);

  return (
    <header
      className={`${dragHandleClass} relative flex items-center gap-1.5 rounded-t-lg px-2 py-1.5 select-none`}
      style={{ background: `hsl(var(--note-${note.color}-header))`, color: `hsl(var(--note-${note.color}-fg))`, cursor: 'move' }}
    >
      <span className="flex-shrink-0 opacity-50" aria-hidden="true">
        <GripVertical size={14} />
      </span>
      <input
        value={note.title}
        onChange={(e) => onChangeTitle(e.target.value)}
        placeholder={t('notes.titlePlaceholder')}
        className="min-w-0 w-full flex-1 border-none bg-transparent px-1.5 py-0.5 text-sm font-semibold outline-none focus:bg-black/10 rounded"
        style={{ color: 'inherit', cursor: 'text' }}
        onMouseDown={(e) => e.stopPropagation()}
      />
      <div className="flex flex-shrink-0 gap-0.5">
        <button type="button" className="h-6 w-6 rounded opacity-65 hover:opacity-100 hover:bg-black/10 flex items-center justify-center"
          title={t('notes.action.color')}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); setPaletteOpen(v => !v); }}
        ><Palette size={14} /></button>
        <button type="button"
          className="h-6 w-6 rounded hover:bg-black/10 flex items-center justify-center"
          style={{ opacity: note.pinned ? 1 : 0.65 }}
          title={note.pinned ? t('notes.action.unpin') : t('notes.action.pin')}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onTogglePin(); }}
        ><Pin size={14} fill={note.pinned ? 'currentColor' : 'none'} /></button>
        <button type="button" className="h-6 w-6 rounded opacity-65 hover:opacity-100 hover:bg-black/10 flex items-center justify-center"
          title={t('notes.action.expand')}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onExpand(); }}
        ><Maximize2 size={14} /></button>
        <button type="button" className="h-6 w-6 rounded opacity-65 hover:opacity-100 hover:bg-black/10 flex items-center justify-center"
          title={t('notes.action.delete')}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
        ><Trash2 size={14} /></button>
        <button type="button" className="h-6 w-6 rounded opacity-65 hover:opacity-100 hover:bg-black/10 flex items-center justify-center"
          title={t('notes.action.minimize')}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onMinimize(); }}
        ><Minus size={14} /></button>
        <button type="button" className="h-6 w-6 rounded opacity-65 hover:opacity-100 hover:bg-black/10 flex items-center justify-center"
          title={t('notes.action.close')}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onClose(); }}
        ><X size={14} /></button>
      </div>
      {paletteOpen && (
        <div className="absolute top-8 right-14 z-20">
          <ColorPalette value={note.color} onChange={(c) => { onChangeColor(c); setPaletteOpen(false); }} />
        </div>
      )}
    </header>
  );
}
