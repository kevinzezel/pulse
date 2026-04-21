'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import ptBR from '@/i18n/locales/pt-BR.json';
import en from '@/i18n/locales/en.json';
import es from '@/i18n/locales/es.json';

const CATALOGS = { 'pt-BR': ptBR, en, es };
const SUPPORTED = ['pt-BR', 'en', 'es'];
const DEFAULT_LOCALE = 'en';
const STORAGE_KEY = 'rt:locale';

const I18nContext = createContext(null);

function detectInitialLocale() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && SUPPORTED.includes(stored)) return stored;
  } catch {}
  if (typeof navigator !== 'undefined' && navigator.language) {
    const nav = navigator.language;
    if (SUPPORTED.includes(nav)) return nav;
    const primary = nav.split('-')[0];
    const match = SUPPORTED.find(l => l.split('-')[0] === primary);
    if (match) return match;
  }
  return DEFAULT_LOCALE;
}

function resolveKey(catalog, key) {
  const parts = key.split('.');
  let current = catalog;
  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = current[part];
    } else {
      return null;
    }
  }
  return typeof current === 'string' ? current : null;
}

function interpolate(template, params) {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, name) => {
    return params[name] !== undefined ? String(params[name]) : `{${name}}`;
  });
}

let currentLocale = DEFAULT_LOCALE;
export function getCurrentLocale() {
  return currentLocale;
}

export function I18nProvider({ children }) {
  const [locale, setLocaleState] = useState(DEFAULT_LOCALE);

  useEffect(() => {
    const initial = detectInitialLocale();
    setLocaleState(initial);
    currentLocale = initial;
    document.documentElement.lang = initial;
  }, []);

  const setLocale = useCallback((next) => {
    if (!SUPPORTED.includes(next)) return;
    setLocaleState(next);
    currentLocale = next;
    document.documentElement.lang = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {}
  }, []);

  const t = useCallback((key, params) => {
    const catalog = CATALOGS[locale] || CATALOGS[DEFAULT_LOCALE];
    const value = resolveKey(catalog, key) ?? resolveKey(CATALOGS[DEFAULT_LOCALE], key) ?? key;
    return interpolate(value, params);
  }, [locale]);

  const formatDate = useCallback((date, options) => {
    const d = date instanceof Date ? date : new Date(date);
    return new Intl.DateTimeFormat(locale, options).format(d);
  }, [locale]);

  const formatTime = useCallback((date) => {
    const d = date instanceof Date ? date : new Date(date);
    return new Intl.DateTimeFormat(locale, {
      hour: '2-digit',
      minute: '2-digit',
    }).format(d);
  }, [locale]);

  return (
    <I18nContext.Provider value={{ locale, setLocale, t, formatDate, formatTime, supported: SUPPORTED }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useTranslation() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useTranslation must be used within I18nProvider');
  return ctx;
}

export function useErrorToast() {
  const { t } = useTranslation();
  return useCallback((err) => {
    if (err?.detail_key) {
      toast.error(t(err.detail_key, err.detail_params));
    } else {
      toast.error(err?.detail || err?.message || t('toast.unexpectedError'));
    }
  }, [t]);
}
