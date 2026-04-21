'use client';

import { useEffect, useRef, useState } from 'react';
import { Palette, Check, Sun, Moon } from 'lucide-react';
import { useTheme } from '@/providers/ThemeProvider';
import { useTranslation } from '@/providers/I18nProvider';

export default function ThemeSelector() {
  const { theme, setTheme, themes, base } = useTheme();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function onClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const darkThemes = themes.filter(th => th.base === 'dark');
  const lightThemes = themes.filter(th => th.base === 'light');

  function labelOf(th) {
    return th.labelKey ? t(th.labelKey) : th.label;
  }

  const BaseIcon = base === 'light' ? Sun : Moon;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
        title={t('header.theme')}
        aria-label={t('header.theme')}
      >
        <Palette size={16} />
        <BaseIcon size={12} className="opacity-70" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-56 rounded-md border border-border bg-card shadow-lg z-50 py-1 max-h-96 overflow-y-auto">
          <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
            <Moon size={10} /> {t('header.themesDark')}
          </div>
          {darkThemes.map((th) => (
            <ThemeRow key={th.id} theme={th} active={theme === th.id} label={labelOf(th)} onSelect={() => { setTheme(th.id); setOpen(false); }} />
          ))}
          <div className="px-3 py-1 mt-1 text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
            <Sun size={10} /> {t('header.themesLight')}
          </div>
          {lightThemes.map((th) => (
            <ThemeRow key={th.id} theme={th} active={theme === th.id} label={labelOf(th)} onSelect={() => { setTheme(th.id); setOpen(false); }} />
          ))}
        </div>
      )}
    </div>
  );
}

function ThemeRow({ active, label, onSelect }) {
  return (
    <button
      onClick={onSelect}
      className="w-full flex items-center justify-between px-3 py-1.5 text-sm text-foreground hover:bg-muted/40 transition-colors"
    >
      <span className="truncate">{label}</span>
      {active && <Check size={13} className="text-primary flex-shrink-0 ml-2" />}
    </button>
  );
}
