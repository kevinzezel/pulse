'use client';

import { useEffect, useRef } from 'react';

const MIN_INTERVAL_MS = 2000;

// Refetch when tab becomes visible again. Debounced so repeated focus events
// don't spam the server. Used to mitigate stale UI when another device has
// updated shared MongoDB-backed data.
export function useRefetchOnFocus(fn, enabled = true) {
  const fnRef = useRef(fn);
  const lastRef = useRef(Date.now());

  useEffect(() => { fnRef.current = fn; }, [fn]);

  useEffect(() => {
    if (!enabled) return;
    function tick() {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastRef.current < MIN_INTERVAL_MS) return;
      lastRef.current = now;
      // Errors are swallowed intentionally — this is a background refetch the
      // user didn't initiate, so a toast would be spam on a flaky network.
      // Warn-level logging preserves visibility for dev/prod logs.
      try { fnRef.current?.(); } catch (err) { console.warn('[useRefetchOnFocus] refetch failed:', err); }
    }
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('focus', tick);
    return () => {
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('focus', tick);
    };
  }, [enabled]);
}
