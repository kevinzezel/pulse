'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useServers } from '@/providers/ServersProvider';
import { getServerVersion, getUpdateStatus } from '@/services/api';
import UpdateAvailableModal from '@/components/UpdateAvailableModal';

const CHECK_INTERVAL_MS = 60 * 60 * 1000;        // 1h
const DISMISS_DURATION_MS = 24 * 60 * 60 * 1000; // 24h
const DISMISS_STORAGE_KEY = 'rt:updateDismiss';

const UpdateContext = createContext(null);

function readDismiss() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(DISMISS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.version !== 'string' || typeof parsed.dismissedAt !== 'number') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeDismiss(version) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(DISMISS_STORAGE_KEY, JSON.stringify({
      version,
      dismissedAt: Date.now(),
    }));
  } catch {}
}

function shouldShow(latestVersion, dismiss) {
  if (!dismiss) return true;
  if (dismiss.version !== latestVersion) return true;
  return (Date.now() - dismiss.dismissedAt) >= DISMISS_DURATION_MS;
}

export function UpdateNotifierProvider({ children }) {
  const pathname = usePathname();
  const { servers, loaded } = useServers();
  const [latestVersion, setLatestVersion] = useState(null);
  const [outdatedServers, setOutdatedServers] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const inFlightRef = useRef(false);

  const runUpdateCheck = useCallback(async ({ force = false } = {}) => {
    if (pathname === '/login') return;
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const status = await getUpdateStatus({ force }).catch((err) => {
        console.warn('[UpdateNotifier] getUpdateStatus failed:', err);
        return null;
      });
      const latest = status?.latestVersion;
      if (!latest) return; // no info, abort silently

      setLatestVersion(latest);

      const list = Array.isArray(servers) ? servers : [];
      if (list.length === 0) {
        setOutdatedServers([]);
        setIsOpen(false);
        return;
      }

      const results = await Promise.allSettled(
        list.map((s) => getServerVersion(s.id).then((data) => ({ id: s.id, data }))),
      );

      const outdated = [];
      for (let i = 0; i < results.length; i++) {
        const server = list[i];
        const r = results[i];
        if (r.status === 'fulfilled') {
          const ver = r.value?.data?.version;
          if (typeof ver === 'string' && ver === latest) continue;
          outdated.push({
            id: server.id,
            name: server.name || `${server.host}:${server.port}`,
            color: server.color || null,
            currentVersion: typeof ver === 'string' ? ver : null,
          });
        } else {
          // Distinguish 404 (pre-feature client) from network errors (offline)
          const err = r.reason;
          if (err?.status === 404) {
            outdated.push({
              id: server.id,
              name: server.name || `${server.host}:${server.port}`,
              color: server.color || null,
              currentVersion: null,
            });
          }
          // Other errors (timeout/unreachable/bad_key/5xx) — skip silently
        }
      }

      setOutdatedServers(outdated);
      if (outdated.length === 0) {
        setIsOpen(false);
        return;
      }

      if (shouldShow(latest, readDismiss())) {
        setIsOpen(true);
      }
    } finally {
      inFlightRef.current = false;
    }
  }, [pathname, servers]);

  // Stable signature of the server set — derived from sorted IDs, not the
  // array reference. ServersProvider re-fetches on focus and assigns a fresh
  // array each time even when nothing changed; without this gate, every tab
  // focus would re-trigger runUpdateCheck and burn N HTTP calls per server.
  const serversSignature = (Array.isArray(servers) ? servers : [])
    .map((s) => s.id)
    .sort()
    .join(',');

  // Force a fresh GitHub fetch on the /login → app transition so the user
  // sees an up-to-date status right after authenticating, instead of being
  // served the up-to-1h-old server-side cache. Periodic ticks (setInterval)
  // continue without force — they pay the rate-limit budget more carefully.
  const prevPathRef = useRef(pathname);

  useEffect(() => {
    if (pathname === '/login') {
      prevPathRef.current = pathname;
      return;
    }
    if (!loaded) return;
    const cameFromLogin = prevPathRef.current === '/login';
    prevPathRef.current = pathname;
    runUpdateCheck({ force: cameFromLogin });
    const id = setInterval(runUpdateCheck, CHECK_INTERVAL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, loaded, serversSignature]);

  const dismiss = useCallback(() => {
    if (latestVersion) writeDismiss(latestVersion);
    setIsOpen(false);
  }, [latestVersion]);

  const recheck = useCallback(() => {
    runUpdateCheck();
  }, [runUpdateCheck]);

  return (
    <UpdateContext.Provider value={{ latestVersion, outdatedServers, isOpen, dismiss, recheck }}>
      {children}
      {isOpen && latestVersion && outdatedServers.length > 0 && (
        <UpdateAvailableModal
          latestVersion={latestVersion}
          outdatedServers={outdatedServers}
          onDismiss={dismiss}
        />
      )}
    </UpdateContext.Provider>
  );
}

export function useUpdate() {
  const ctx = useContext(UpdateContext);
  if (!ctx) throw new Error('useUpdate must be used within UpdateNotifierProvider');
  return ctx;
}
