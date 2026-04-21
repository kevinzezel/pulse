export const NOTE_COLORS = ['yellow', 'pink', 'blue', 'green', 'purple', 'slate', 'white'];

export const DEFAULT_COLOR = 'yellow';
export const DEFAULT_WIDTH = 280;
export const DEFAULT_HEIGHT = 220;

export const MIN_WIDTH = 200;
export const MIN_HEIGHT = 140;
export const MAX_WIDTH = 2000;
export const MAX_HEIGHT = 2000;
export const MAX_COORD = 10000;

export const TITLE_MAX = 200;
export const CONTENT_MAX = 50000;

export const CASCADE_OFFSET = 24;
export const INITIAL_X = 120;
export const INITIAL_Y = 100;

export const SAVE_DEBOUNCE_MS = 300;

export const BASE_Z = 1000;
export const PINNED_BASE_Z = 2000;

export function isValidColor(c) {
  return NOTE_COLORS.includes(c);
}

export function nextCascadePosition(notes) {
  const visible = notes.filter((n) => n.open);
  if (visible.length === 0) return { x: INITIAL_X, y: INITIAL_Y };
  const offset = (visible.length % 10) * CASCADE_OFFSET;
  return { x: INITIAL_X + offset, y: INITIAL_Y + offset };
}

export function isNoteEmpty(note) {
  if (!note) return true;
  const t = typeof note.title === 'string' ? note.title.trim() : '';
  const c = typeof note.content === 'string' ? note.content.trim() : '';
  return !t && !c;
}
