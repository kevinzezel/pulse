'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { StickyNote as IconNote } from 'lucide-react';
import { useTranslation } from '@/providers/I18nProvider';
import { useNotes } from '@/providers/NotesProvider';
import { useIsMobile } from '@/hooks/layout';
import { StickyNote } from './StickyNote';

const CORNER_KEY = 'rt:notesFab:corner';
const VALID_CORNERS = ['bottom-right', 'bottom-left', 'top-right', 'top-left'];
const DEFAULT_CORNER = 'bottom-right';
const EDGE_OFFSET = 24;
const DRAG_THRESHOLD_PX = 4;

function loadCorner() {
  if (typeof window === 'undefined') return DEFAULT_CORNER;
  try {
    const v = localStorage.getItem(CORNER_KEY);
    return VALID_CORNERS.includes(v) ? v : DEFAULT_CORNER;
  } catch { return DEFAULT_CORNER; }
}

function saveCorner(c) {
  try { localStorage.setItem(CORNER_KEY, c); } catch {}
}

function cornerFromPoint(cx, cy, vw, vh) {
  const h = cx < vw / 2 ? 'left' : 'right';
  const v = cy < vh / 2 ? 'top' : 'bottom';
  return `${v}-${h}`;
}

function cornerStyle(corner) {
  const [v, h] = corner.split('-');
  return { [v]: EDGE_OFFSET, [h]: EDGE_OFFSET };
}

export function NotesFab() {
  const { t } = useTranslation();
  const { setManagerOpen, openNotes } = useNotes();
  const isMobile = useIsMobile();
  const [mounted, setMounted] = useState(false);
  const [corner, setCorner] = useState(DEFAULT_CORNER);
  const [dragPos, setDragPos] = useState(null);
  const fabRef = useRef(null);
  const dragState = useRef({ active: false, moved: false, pointerId: null, offsetX: 0, offsetY: 0, startX: 0, startY: 0, w: 0, h: 0 });

  useEffect(() => {
    setMounted(true);
    setCorner(loadCorner());
  }, []);

  function handlePointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    const el = fabRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragState.current = {
      active: true,
      moved: false,
      pointerId: e.pointerId,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      startX: e.clientX,
      startY: e.clientY,
      w: rect.width,
      h: rect.height,
    };
    try { el.setPointerCapture(e.pointerId); } catch {}
  }

  function handlePointerMove(e) {
    const s = dragState.current;
    if (!s.active) return;
    const dx = Math.abs(e.clientX - s.startX);
    const dy = Math.abs(e.clientY - s.startY);
    if (!s.moved && (dx > DRAG_THRESHOLD_PX || dy > DRAG_THRESHOLD_PX)) {
      s.moved = true;
    }
    if (s.moved) {
      setDragPos({ x: e.clientX - s.offsetX, y: e.clientY - s.offsetY });
    }
  }

  function handlePointerUp(e) {
    const s = dragState.current;
    if (!s.active) return;
    const el = fabRef.current;
    try { el?.releasePointerCapture(s.pointerId); } catch {}
    s.active = false;

    if (s.moved && dragPos) {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const cx = dragPos.x + s.w / 2;
      const cy = dragPos.y + s.h / 2;
      const newCorner = cornerFromPoint(cx, cy, vw, vh);
      setCorner(newCorner);
      saveCorner(newCorner);
      setDragPos(null);
    } else {
      setDragPos(null);
      setManagerOpen(true);
    }
  }

  function handlePointerCancel() {
    const s = dragState.current;
    if (!s.active) return;
    s.active = false;
    setDragPos(null);
  }

  if (isMobile) {
    return null;
  }

  const badge = openNotes.length > 0 ? openNotes.length : null;

  const positionStyle = dragPos
    ? { left: dragPos.x, top: dragPos.y, right: 'auto', bottom: 'auto', transition: 'none' }
    : { ...cornerStyle(corner), transition: 'top 200ms ease, left 200ms ease, right 200ms ease, bottom 200ms ease' };

  return (
    <>
      <button
        ref={fabRef}
        type="button"
        className="fixed z-[9000] flex h-11 w-11 items-center justify-center rounded-full shadow-lg hover:shadow-xl"
        style={{
          ...positionStyle,
          background: 'hsl(var(--primary))',
          color: 'hsl(var(--primary-foreground))',
          cursor: dragPos ? 'grabbing' : 'grab',
          touchAction: 'none',
          userSelect: 'none',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        title={t('notes.fab')}
      >
        <IconNote size={18} />
        {badge !== null && (
          <span
            className="absolute -right-1 -top-1 flex min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none pointer-events-none"
            style={{
              height: 18,
              background: 'hsl(var(--destructive))',
              color: 'white',
              border: '2px solid hsl(var(--background))',
            }}
          >
            {badge}
          </span>
        )}
      </button>

      {mounted && createPortal(
        <>
          {openNotes.map((n) => (
            <StickyNote key={n.id} note={n} />
          ))}
        </>,
        document.body
      )}
    </>
  );
}
