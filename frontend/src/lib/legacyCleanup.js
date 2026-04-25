'use client';

let didRun = false;

export function cleanupLegacyKeys() {
  if (didRun) return;
  didRun = true;
  if (typeof window === 'undefined') return;
  try {
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (k.startsWith('rt:tab::') || k === 'rt:tab-profiles' || k === 'rt:migrated-from-server') {
        toRemove.push(k);
      }
    }
    for (const k of toRemove) localStorage.removeItem(k);
  } catch {}
  try { sessionStorage.removeItem('rt:tab-uuid'); } catch {}
}
