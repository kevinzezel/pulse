'use client';

export function ssRead(key, fallback) {
  if (!key) return fallback;
  try {
    const raw = sessionStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function ssWrite(key, value) {
  if (!key) return;
  try {
    if (value === undefined || value === null) {
      sessionStorage.removeItem(key);
    } else {
      sessionStorage.setItem(key, JSON.stringify(value));
    }
  } catch {}
}

export function ssRemove(key) {
  if (!key) return;
  try { sessionStorage.removeItem(key); } catch {}
}

export function ssListKeysWithPrefix(prefix) {
  if (!prefix) return [];
  const out = [];
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(prefix)) out.push(k);
    }
  } catch {}
  return out;
}
