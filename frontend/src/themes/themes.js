export const THEMES = [
  { id: 'dark', labelKey: 'themes.defaultDark', base: 'dark' },
  { id: 'light', labelKey: 'themes.defaultLight', base: 'light' },
  { id: 'dracula', label: 'Dracula', base: 'dark' },
  { id: 'nord', label: 'Nord', base: 'dark' },
  { id: 'tokyo-night', label: 'Tokyo Night', base: 'dark' },
  { id: 'one-dark', label: 'One Dark', base: 'dark' },
  { id: 'gruvbox-dark', label: 'Gruvbox Dark', base: 'dark' },
  { id: 'monokai', label: 'Monokai', base: 'dark' },
  { id: 'solarized-dark', label: 'Solarized Dark', base: 'dark' },
  { id: 'github-dark-dimmed', label: 'GitHub Dark Dimmed', base: 'dark' },
  { id: 'catppuccin-mocha', label: 'Catppuccin Mocha', base: 'dark' },
  { id: 'catppuccin-macchiato', label: 'Catppuccin Macchiato', base: 'dark' },
  { id: 'catppuccin-frappe', label: 'Catppuccin Frappé', base: 'dark' },
  { id: 'solarized-light', label: 'Solarized Light', base: 'light' },
  { id: 'gruvbox-light', label: 'Gruvbox Light', base: 'light' },
  { id: 'catppuccin-latte', label: 'Catppuccin Latte', base: 'light' },
];

export const THEME_IDS = THEMES.map(t => t.id);
export const DEFAULT_THEME = 'dark';

export function getThemeMeta(id) {
  return THEMES.find(t => t.id === id) || THEMES[0];
}

export function applyThemeClasses(id) {
  const meta = getThemeMeta(id);
  const root = document.documentElement;
  root.classList.remove('dark', 'light');
  for (const cls of Array.from(root.classList)) {
    if (cls.startsWith('theme-')) root.classList.remove(cls);
  }
  root.classList.add(meta.base);
  if (id !== 'dark' && id !== 'light') {
    root.classList.add(`theme-${id}`);
  }
}
