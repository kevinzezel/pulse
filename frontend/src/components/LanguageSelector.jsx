'use client';

import { useEffect, useRef, useState } from 'react';
import { Globe, Check } from 'lucide-react';
import { useTranslation } from '@/providers/I18nProvider';

const LANGUAGE_LABELS = {
  'pt-BR': 'Português',
  'en': 'English',
  'es': 'Español',
};

const SHORT_CODES = {
  'pt-BR': 'PT',
  'en': 'EN',
  'es': 'ES',
};

export default function LanguageSelector() {
  const { locale, setLocale, supported, t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function onClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
        title={t('header.language')}
        aria-label={t('header.language')}
      >
        <Globe size={16} />
        <span className="text-xs font-medium">{SHORT_CODES[locale]}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-40 rounded-md border border-border bg-card shadow-lg z-50 py-1">
          {supported.map((code) => (
            <button
              key={code}
              onClick={() => { setLocale(code); setOpen(false); }}
              className="w-full flex items-center justify-between px-3 py-1.5 text-sm text-foreground hover:bg-muted/40 transition-colors"
            >
              <span>{LANGUAGE_LABELS[code]}</span>
              {locale === code && <Check size={13} className="text-primary" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
