'use client';

import { useState } from 'react';
import { sendKey } from './TerminalPane';

const KEYS = [
  { label: 'Esc', data: '\x1b' },
  { label: '⇧', kind: 'shift' },
  { label: 'Tab', data: '\t', shiftedData: '\x1b[Z' },
  { label: '/', data: '/' },
  { label: '←', data: '\x1b[D', wide: true },
  { label: '→', data: '\x1b[C', wide: true },
  { label: '↑', data: '\x1b[A', wide: true },
  { label: '↓', data: '\x1b[B', wide: true },
  { label: '↵', data: '\r', wide: true, big: true },
  { label: 'Clr', data: '\x03' },
];

export default function MobileKeyBar({ sessionId, compact = false }) {
  const [shiftArmed, setShiftArmed] = useState(false);

  function handleKey(key) {
    if (key.kind === 'shift') {
      setShiftArmed((v) => !v);
      return;
    }
    if (!sessionId) return;
    const payload = shiftArmed && key.shiftedData ? key.shiftedData : key.data;
    sendKey(sessionId, payload);
    if (shiftArmed) setShiftArmed(false);
  }

  const containerClass = compact
    ? 'mt-auto flex flex-col items-center gap-1 p-1 flex-shrink-0 border-t'
    : 'flex items-stretch gap-0.5 px-1 py-0.5 flex-shrink-0 border-t';

  const buttonClass = (key) => {
    const base = compact
      ? `w-10 h-8 ${key.big ? 'text-lg' : key.wide ? 'text-sm' : 'text-[10px]'}`
      : `flex-1 min-w-0 py-0.5 ${key.big ? 'text-lg' : key.wide ? 'text-base' : 'text-xs'}`;
    const disabled = key.kind !== 'shift' && !sessionId ? 'opacity-40 pointer-events-none' : '';
    const active = key.kind === 'shift' && shiftArmed
      ? 'bg-primary/20 text-primary ring-1 ring-primary/40'
      : 'text-foreground hover:bg-muted/50 active:bg-muted';
    return `${base} rounded-md font-mono transition-colors flex items-center justify-center ${active} ${disabled}`;
  };

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
          className={buttonClass(key)}
          aria-pressed={key.kind === 'shift' ? shiftArmed : undefined}
        >
          {key.label}
        </button>
      ))}
    </div>
  );
}
