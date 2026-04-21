'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { THEMES, THEME_IDS, DEFAULT_THEME, applyThemeClasses, getThemeMeta } from '@/themes/themes';

const ThemeContext = createContext(null);
const STORAGE_KEY = 'rt:theme';

function loadTheme() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && THEME_IDS.includes(stored)) return stored;
  } catch {}
  return DEFAULT_THEME;
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(DEFAULT_THEME);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const initial = loadTheme();
    setThemeState(initial);
    applyThemeClasses(initial);
    setHydrated(true);
  }, []);

  function setTheme(next) {
    if (!THEME_IDS.includes(next)) return;
    setThemeState(next);
    applyThemeClasses(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {}
  }

  const meta = getThemeMeta(theme);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, themes: THEMES, base: meta.base, hydrated }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
