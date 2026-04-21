'use client';

import { sendKey } from './TerminalPane';

const KEYS = [
  { label: 'Esc', data: '\x1b' },
  { label: '⇧Tab', data: '\x1b[Z' },
  { label: '/', data: '/' },
  { label: '←', data: '\x1b[D', wide: true },
  { label: '→', data: '\x1b[C', wide: true },
  { label: '↑', data: '\x1b[A', wide: true },
  { label: '↓', data: '\x1b[B', wide: true },
  { label: '↵', data: '\r', wide: true, big: true },
  { label: 'Clr', data: '\x03' },
];

export default function MobileKeyBar({ sessionId, compact = false }) {
  function handleKey(key) {
    if (!sessionId) return;
    sendKey(sessionId, key.data);
  }

  const containerClass = compact
    ? 'mt-auto flex flex-col items-center gap-1 p-1 flex-shrink-0 border-t'
    : 'flex items-stretch gap-0.5 px-1 py-0.5 flex-shrink-0 border-t';

  const buttonClass = (wide, big) => `${
    compact
      ? `w-10 h-8 ${big ? 'text-lg' : wide ? 'text-sm' : 'text-[10px]'}`
      : `flex-1 min-w-0 py-0.5 ${big ? 'text-lg' : wide ? 'text-base' : 'text-xs'}`
  } rounded-md font-mono transition-colors flex items-center justify-center text-foreground hover:bg-muted/50 active:bg-muted ${!sessionId ? 'opacity-40 pointer-events-none' : ''}`;

  return (
    <div
      className={containerClass}
      style={{ borderColor: 'hsl(var(--sidebar-border))' }}
    >
      {KEYS.map(key => (
        <button
          key={key.label}
          onPointerDown={(e) => {
            e.preventDefault();
            handleKey(key);
          }}
          className={buttonClass(key.wide, key.big)}
        >
          {key.label}
        </button>
      ))}
    </div>
  );
}
