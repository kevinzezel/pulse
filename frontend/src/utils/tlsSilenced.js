const SILENCED_KEY = 'rt:tlsModalSilencedServerIds';

export function readSilencedIds() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(SILENCED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function writeSilencedIds(ids) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(SILENCED_KEY, JSON.stringify(ids));
  } catch {}
}

export function addSilencedId(id) {
  const next = Array.from(new Set([...readSilencedIds(), id]));
  writeSilencedIds(next);
  return next;
}

export function removeSilencedId(id) {
  const next = readSilencedIds().filter((x) => x !== id);
  writeSilencedIds(next);
  return next;
}
