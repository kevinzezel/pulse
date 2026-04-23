'use client';

export function readJSON(key, fallback) {
  if (!key) return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function writeJSON(key, value) {
  if (!key) return;
  try {
    if (value === undefined || value === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify(value));
    }
  } catch {}
}

export function removeKey(key) {
  if (!key) return;
  try { localStorage.removeItem(key); } catch {}
}
