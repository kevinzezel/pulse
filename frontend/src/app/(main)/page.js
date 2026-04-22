'use client';

import { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import {
  getSessions, createSession, killSession, renameSession, syncSessions, cloneSession,
  getGroups, createGroup, assignSessionGroup, setGroupHidden, saveGroups, setSessionNotify, createPrompt,
  getLayouts, setLayouts, composeSessionId, splitSessionId,
  getSessionsSnapshot, setSessionsSnapshot, restoreSessions,
  getComposeDrafts, setComposeDrafts as putComposeDrafts,
} from '@/services/api';
import { reorderById } from '@/utils/reorder';
import { replaceInTree, removeFromTree, getVisibleSessionIds, validateTree } from '@/utils/mosaicHelpers';
import { destroyTerminal, destroyAllTerminals, sendKey, hasDeadConnections } from '@/components/TerminalPane';
import { useTranslation, useErrorToast } from '@/providers/I18nProvider';
import { useServers } from '@/providers/ServersProvider';
import { useProjects } from '@/providers/ProjectsProvider';
import { useViewState } from '@/providers/ViewStateProvider';
import { useIsMobile } from '@/hooks/layout';
import dynamic from 'next/dynamic';
import Sidebar from '@/components/Sidebar';
import GroupSelector from '@/components/GroupSelector';
import ComposeModal from '@/components/ComposeModal';
import MobileKeyBar from '@/components/MobileKeyBar';
const TerminalMosaic = dynamic(() => import('@/components/TerminalMosaic'), { ssr: false });

const EMPTY_ARRAY = [];

function loadFromStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export default function DashboardPage() {
  return (
    <Suspense fallback={null}>
      <Dashboard />
    </Suspense>
  );
}

function Dashboard() {
  const { t } = useTranslation();
  const showError = useErrorToast();
  const { servers, loading: serversLoading } = useServers();
  const { activeProjectId } = useProjects();
  const { getProjectGroup, setProjectGroup, hydrated: hydratedViewState } = useViewState();
  const router = useRouter();
  const searchParams = useSearchParams();
  const handledSessionRef = useRef(null);
  const [sessions, setSessions] = useState([]);
  const [groups, setGroups] = useState([]);
  const [offlineServerIds, setOfflineServerIds] = useState([]);
  const [mosaicLayouts, setMosaicLayouts] = useState({});
  const [hydratedLayouts, setHydratedLayouts] = useState(false);
  const [hydratedGroups, setHydratedGroups] = useState(false);
  const [hydratedSessions, setHydratedSessions] = useState(false);
  const [sessionsProjectId, setSessionsProjectId] = useState(null);
  const [groupsProjectId, setGroupsProjectId] = useState(null);
  const [savedLayout, setSavedLayout] = useState(null);
  const layoutsSaveTimer = useRef(null);
  const snapshotDebounceRef = useRef(null);
  const restoreAttemptedRef = useRef(false);
  const [busySessionIds, setBusySessionIds] = useState(new Set());
  const [draggingId, setDraggingId] = useState(null);
  const [reconnectKey, setReconnectKey] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeTerminalId, setActiveTerminalId] = useState(() => loadFromStorage('rt:activeTerminalId', null));
  const [hydrated, setHydrated] = useState(false);
  const [composeDrafts, setComposeDrafts] = useState({});
  const [hydratedComposeDrafts, setHydratedComposeDrafts] = useState(false);
  const [composeTargetId, setComposeTargetId] = useState(null);
  const [composeLoadingId, setComposeLoadingId] = useState(null);

  const selectedGroupId = hydratedViewState ? getProjectGroup(activeProjectId) : null;
  const setSelectedGroupId = useCallback((id) => {
    if (!activeProjectId) return;
    setProjectGroup(activeProjectId, id);
  }, [activeProjectId, setProjectGroup]);

  const isMobile = useIsMobile();
  const isMaximized = savedLayout !== null;

  useEffect(() => {
    setHydrated(true);
    const stored = loadFromStorage('rt:sidebarOpen', true);
    setSidebarOpen(stored);
  }, []);

  useEffect(() => {
    async function run() {
      try {
        const data = await getLayouts();
        const raw = data.layouts || {};
        const normalized = {};
        for (const [k, v] of Object.entries(raw)) {
          if (v && typeof v === 'object' && !Array.isArray(v) && 'mosaic' in v) {
            normalized[k] = v.mosaic ?? null;
          } else {
            normalized[k] = v ?? null;
          }
        }
        if (Object.keys(normalized).length === 0) {
          try {
            const legacyLayout = localStorage.getItem('rt:mosaicLayout');
            if (legacyLayout) {
              const legacy = JSON.parse(legacyLayout);
              if (legacy) {
                normalized[`${activeProjectId}::__none__`] = legacy;
                await setLayouts(normalized).catch(() => {});
              }
            }
            localStorage.removeItem('rt:mosaicLayout');
            localStorage.removeItem('rt:mobileOpenIds');
          } catch {}
        } else {
          localStorage.removeItem('rt:mosaicLayout');
          localStorage.removeItem('rt:mobileOpenIds');
        }
        setMosaicLayouts(normalized);
      } catch (err) {
        console.warn('[getLayouts] failed', err);
      } finally {
        setHydratedLayouts(true);
      }
    }
    run();
  }, []);

  useEffect(() => {
    async function run() {
      try {
        const data = await getComposeDrafts();
        setComposeDrafts(data?.drafts || {});
      } catch (err) {
        console.warn('[getComposeDrafts] failed', err);
      } finally {
        setHydratedComposeDrafts(true);
      }
    }
    run();
  }, []);

  useEffect(() => {
    if (!hydratedLayouts) return;
    if (layoutsSaveTimer.current) clearTimeout(layoutsSaveTimer.current);
    layoutsSaveTimer.current = setTimeout(() => {
      setLayouts(mosaicLayouts).catch(err => console.warn('[setLayouts] failed', err));
    }, 500);
    return () => { if (layoutsSaveTimer.current) clearTimeout(layoutsSaveTimer.current); };
  }, [mosaicLayouts, hydratedLayouts]);

  useEffect(() => {
    if (!hydrated || !hydratedGroups) return;
    if (groupsProjectId !== activeProjectId) return;
    if (selectedGroupId === null) return;
    const match = groups.find(g => g.id === selectedGroupId);
    if (!match || match.hidden) {
      setSelectedGroupId(null);
    }
  }, [groups, selectedGroupId, hydrated, hydratedGroups, groupsProjectId, activeProjectId, setSelectedGroupId]);

  const sessionsInSelectedGroup = useMemo(() => {
    const validGroupIds = new Set(groups.map(g => g.id));
    return sessions.filter(s => {
      const gid = s.group_id && validGroupIds.has(s.group_id) ? s.group_id : null;
      return gid === selectedGroupId;
    });
  }, [sessions, groups, selectedGroupId]);

  const groupKey = `${activeProjectId}::${selectedGroupId ?? '__none__'}`;
  const mosaicLayout = (sessionsProjectId === activeProjectId && groupsProjectId === activeProjectId)
    ? (mosaicLayouts[groupKey] ?? null)
    : null;

  const setMosaicLayout = useCallback((updater) => {
    setMosaicLayouts(prev => {
      const key = `${activeProjectId}::${selectedGroupId ?? '__none__'}`;
      const cur = prev[key] ?? null;
      const next = typeof updater === 'function' ? updater(cur) : updater;
      if (next === cur) return prev;
      return { ...prev, [key]: next };
    });
  }, [selectedGroupId, activeProjectId]);

  const mobileOpenIds = useMemo(() => Array.from(getVisibleSessionIds(mosaicLayout)), [mosaicLayout]);

  useEffect(() => {
    if (!hydratedLayouts || !hydratedSessions || !hydratedGroups) return;
    if (sessionsProjectId !== activeProjectId) return;
    if (groupsProjectId !== activeProjectId) return;
    const validGroupIds = new Set(groups.map(g => g.id));
    const sessionGroupMap = new Map();
    for (const s of sessions) {
      const gid = s.group_id && validGroupIds.has(s.group_id) ? s.group_id : null;
      sessionGroupMap.set(s.id, gid);
    }
    setMosaicLayouts(prev => {
      let changed = false;
      const next = {};
      for (const [k, v] of Object.entries(prev)) {
        const projectOfKey = k.includes('::') ? k.split('::')[0] : null;
        if (projectOfKey !== activeProjectId) {
          next[k] = v;
          continue;
        }
        const groupOfKey = k.split('::')[1];
        const targetGroup = groupOfKey === '__none__' ? null : groupOfKey;
        const keyValidIds = new Set();
        for (const [sid, gid] of sessionGroupMap) {
          if (gid === targetGroup) keyValidIds.add(sid);
        }
        const cleaned = v ? validateTree(v, keyValidIds) : v;
        next[k] = cleaned;
        if (cleaned !== v) changed = true;
      }
      return changed ? next : prev;
    });
  }, [sessions, groups, hydratedLayouts, hydratedSessions, hydratedGroups, activeProjectId, sessionsProjectId, groupsProjectId]);

  useEffect(() => {
    if (!hydratedLayouts || !hydratedGroups) return;
    if (groupsProjectId !== activeProjectId) return;
    const validKeys = new Set([
      `${activeProjectId}::__none__`,
      ...groups.map((g) => `${activeProjectId}::${g.id}`),
    ]);
    setMosaicLayouts(prev => {
      const next = {};
      let changed = false;
      for (const [k, v] of Object.entries(prev)) {
        // keep keys of THIS project (to prune stale gids); keep keys of OTHER projects intact
        const projectOfKey = k.includes('::') ? k.split('::')[0] : null;
        if (projectOfKey !== activeProjectId) {
          next[k] = v;
          continue;
        }
        if (validKeys.has(k)) next[k] = v;
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [groups, hydratedLayouts, hydratedGroups, activeProjectId, groupsProjectId]);

  useEffect(() => {
    if (!hydrated) return;
    setActiveTerminalId(prev => {
      if (prev && mobileOpenIds.includes(prev)) return prev;
      return mobileOpenIds[0] || null;
    });
  }, [mobileOpenIds, hydrated]);

  useEffect(() => { if (hydrated) localStorage.setItem('rt:sidebarOpen', JSON.stringify(sidebarOpen)); }, [sidebarOpen, hydrated]);
  useEffect(() => { if (hydrated) localStorage.setItem('rt:activeTerminalId', JSON.stringify(activeTerminalId)); }, [activeTerminalId, hydrated]);

  useEffect(() => {
    if (isMobile && hydrated) setSidebarOpen(false);
  }, [isMobile, hydrated]);

  const fetchSessions = useCallback(async () => {
    if (servers.length === 0) {
      setSessions([]);
      setOfflineServerIds([]);
      setSessionsProjectId(activeProjectId);
      setHydratedSessions(true);
      return;
    }
    const results = await Promise.allSettled(
      servers.map(async (srv) => {
        const data = await getSessions(srv.id);
        return (data.sessions || [])
          .filter((s) => !s.project_id || s.project_id === activeProjectId)
          .map(s => ({
            ...s,
            id: composeSessionId(srv.id, s.id),
            server_id: srv.id,
            server_name: srv.name,
            server_color: srv.color,
          }));
      })
    );
    const merged = [];
    const offline = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        merged.push(...r.value);
      } else {
        const srv = servers[i];
        offline.push(srv.id);
        const reason = r.reason?.reason || 'unreachable';
        console.warn('[fetchSessions] server offline', srv.name, reason, r.reason);
      }
    });
    setSessions(merged);
    setOfflineServerIds(offline);
    setSessionsProjectId(activeProjectId);
    setHydratedSessions(true);
  }, [servers, activeProjectId]);

  const fetchGroups = useCallback(async () => {
    if (servers.length === 0) {
      setGroups([]);
      setGroupsProjectId(activeProjectId);
      setHydratedGroups(true);
      return;
    }
    try {
      const data = await getGroups();
      const list = (data.groups || []).filter((g) => g.project_id === activeProjectId);
      setGroups(list);
    } catch (err) {
      showError(err);
    } finally {
      setGroupsProjectId(activeProjectId);
      setHydratedGroups(true);
    }
  }, [servers.length, showError, activeProjectId]);

  useEffect(() => {
    if (serversLoading) return;
    (async () => {
      if (servers.length > 0) {
        await Promise.allSettled(
          servers.map(srv => syncSessions(srv.id).catch(() => null))
        );
      }
      await fetchSessions();
    })();
    fetchGroups();
  }, [serversLoading, servers, fetchSessions, fetchGroups]);

  useEffect(() => {
    if (!hydratedSessions) return;
    if (servers.length === 0) return;

    if (snapshotDebounceRef.current) clearTimeout(snapshotDebounceRef.current);
    snapshotDebounceRef.current = setTimeout(async () => {
      try {
        const current = await getSessionsSnapshot();
        const mergedServers = { ...(current?.servers || {}) };

        const liveByServer = {};
        for (const s of sessions) {
          const { serverId, sessionId } = splitSessionId(s.id);
          if (!serverId) continue;
          (liveByServer[serverId] ||= []).push({
            id: sessionId,
            name: s.name,
            group_id: s.group_id || null,
            notify_on_idle: Boolean(s.notify_on_idle),
            cwd: s.cwd || null,
            created_at: s.created_at,
            project_id: s.project_id || activeProjectId,
          });
        }

        const offlineSet = new Set(offlineServerIds);
        for (const srv of servers) {
          if (offlineSet.has(srv.id)) continue;
          const existing = Array.isArray(mergedServers[srv.id]) ? mergedServers[srv.id] : [];
          const otherProjects = existing.filter((s) => s && s.project_id && s.project_id !== activeProjectId);
          mergedServers[srv.id] = [...otherProjects, ...(liveByServer[srv.id] || [])];
        }

        await setSessionsSnapshot({ servers: mergedServers });
      } catch (err) {
        console.warn('[sessionsSnapshot] persist failed', err);
      }
    }, 500);
  }, [sessions, offlineServerIds, hydratedSessions, servers, activeProjectId]);

  useEffect(() => {
    if (!hydratedSessions) return;
    if (!hydratedComposeDrafts) return;
    if (servers.length === 0) return;

    const liveByServer = {};
    for (const s of sessions) {
      const { serverId, sessionId } = splitSessionId(s.id);
      if (!serverId) continue;
      (liveByServer[serverId] ||= new Set()).add(sessionId);
    }
    const offlineSet = new Set(offlineServerIds);
    const knownServerIds = new Set(servers.map(s => s.id));

    let changed = false;
    const next = {};
    for (const [compositeId, draft] of Object.entries(composeDrafts)) {
      const { serverId, sessionId } = splitSessionId(compositeId);
      if (!serverId || !sessionId) { changed = true; continue; }
      if (!knownServerIds.has(serverId)) { changed = true; continue; }
      if (offlineSet.has(serverId)) {
        next[compositeId] = draft;
        continue;
      }
      const liveSet = liveByServer[serverId];
      if (liveSet && liveSet.has(sessionId)) {
        next[compositeId] = draft;
      } else {
        changed = true;
      }
    }
    if (!changed) return;

    setComposeDrafts(next);
    putComposeDrafts({ drafts: next }).catch(err =>
      console.warn('[setComposeDrafts] cleanup failed', err)
    );
  }, [sessions, offlineServerIds, servers, composeDrafts, hydratedSessions, hydratedComposeDrafts]);

  useEffect(() => {
    return () => {
      if (snapshotDebounceRef.current) clearTimeout(snapshotDebounceRef.current);
    };
  }, []);

  useEffect(() => {
    if (restoreAttemptedRef.current) return;
    if (serversLoading) return;
    if (!servers || servers.length === 0) return;
    if (!hydratedSessions) return;

    (async () => {
      let snapshot;
      try {
        snapshot = await getSessionsSnapshot();
      } catch {
        return;
      }
      if (!snapshot?.servers) return;

      const liveByServer = {};
      for (const s of sessions) {
        const { serverId, sessionId } = splitSessionId(s.id);
        if (!serverId) continue;
        (liveByServer[serverId] ||= new Set()).add(sessionId);
      }

      // Don't gate the restore on `offlineServerIds` — on fresh boot, the very
      // first `fetchSessions` races the client booting up and can mark the
      // server offline even though the client is seconds from being ready.
      // The catch below turns a still-offline restore into a no-op; the win
      // is that users coming back after a reboot see their sessions reappear
      // at the same cwd as soon as the client is listening.
      const restorePromises = [];
      for (const [serverId, snapList] of Object.entries(snapshot.servers)) {
        if (!servers.some(srv => srv.id === serverId)) continue;
        const liveSet = liveByServer[serverId] || new Set();
        const missing = snapList.filter(s => !liveSet.has(s.id));
        if (missing.length === 0) continue;
        restorePromises.push(
          restoreSessions(serverId, missing)
            .then(res => ({ serverId, res }))
            .catch(err => ({ serverId, err }))
        );
      }
      if (restorePromises.length === 0) {
        // Nothing to restore — consider the attempt done so we don't keep re-running.
        restoreAttemptedRef.current = true;
        return;
      }

      const results = await Promise.all(restorePromises);
      const totalRestored = results.reduce(
        (sum, r) => sum + (r.res?.restored?.length || 0), 0
      );
      // Only mark the attempt complete when every request actually reached the
      // client. If any failed (usually because the client was still booting on
      // fresh reboot), leave the ref false — the effect is gated on deps that
      // include `offlineServerIds`, so the next successful fetchSessions will
      // retrigger this and the restore eventually goes through.
      const anyFailed = results.some(r => r.err);
      if (!anyFailed) {
        restoreAttemptedRef.current = true;
      }
      if (totalRestored > 0) {
        toast.success(t('toast.sessions_auto_restored', { count: totalRestored }));
        fetchSessions();
      }
    })();
  }, [servers, serversLoading, hydratedSessions, sessions, offlineServerIds, fetchSessions, t]);

  useEffect(() => {
    function handler(ev) {
      const composedId = ev?.detail?.sessionId;
      if (!composedId) return;
      const session = sessions.find(s => s.id === composedId);
      if (!session) return;
      const targetGroupId = session.group_id || null;

      try { window.focus?.(); } catch {}

      const group = targetGroupId ? groups.find(g => g.id === targetGroupId) : null;
      if (group && group.hidden) {
        const prevGroups = groups;
        setGroups(g => g.map(gg => gg.id === targetGroupId ? { ...gg, hidden: false } : gg));
        setGroupHidden(targetGroupId, false).catch(err => {
          setGroups(prevGroups);
          showError(err);
        });
      }

      if (targetGroupId !== selectedGroupId) {
        setSelectedGroupId(targetGroupId);
      }

      const targetKey = `${activeProjectId}::${targetGroupId ?? '__none__'}`;
      const targetLayout = mosaicLayouts[targetKey] ?? null;
      const visibleIds = getVisibleSessionIds(targetLayout);
      if (!visibleIds.has(composedId)) {
        if (isMaximized) setSavedLayout(null);
        setMosaicLayouts(prev => {
          const cur = prev[targetKey] ?? null;
          const nextLayout = cur
            ? { type: 'split', direction: 'row', children: [cur, composedId], splitPercentages: [50, 50] }
            : composedId;
          return { ...prev, [targetKey]: nextLayout };
        });
      }

      if (isMobile) {
        setActiveTerminalId(composedId);
        setSidebarOpen(false);
      }
    }
    window.addEventListener('rt:focus-session', handler);
    return () => window.removeEventListener('rt:focus-session', handler);
  }, [sessions, groups, selectedGroupId, mosaicLayouts, isMaximized, isMobile, showError, activeProjectId]);

  useEffect(() => {
    if (!hydrated) return;
    if (!sessions.length) return;
    const sid = searchParams.get('session');
    if (!sid) { handledSessionRef.current = null; return; }
    if (handledSessionRef.current === sid) return;

    const session = sessions.find(s => s.id === sid);
    if (!session) {
      handledSessionRef.current = sid;
      router.replace('/');
      return;
    }

    handledSessionRef.current = sid;

    const visibleIds = getVisibleSessionIds(mosaicLayout);
    if (!visibleIds.has(sid)) {
      if (isMaximized) setSavedLayout(null);
      setMosaicLayout(prev => {
        if (!prev) return sid;
        return {
          type: 'split',
          direction: 'row',
          children: [prev, sid],
          splitPercentages: [50, 50],
        };
      });
    }
    if (isMobile) {
      setActiveTerminalId(sid);
      setSidebarOpen(false);
    }

    router.replace('/');
  }, [searchParams, sessions, hydrated, isMobile, mosaicLayout, isMaximized, router]);

  const visibleSessionIds = useMemo(() => {
    const ids = getVisibleSessionIds(mosaicLayout);
    if (draggingId) ids.add(draggingId);
    return ids;
  }, [mosaicLayout, draggingId]);

  function handleSelectSession(sessionId) {
    if (sessionId === draggingId) return;

    if (isMobile) {
      if (!mobileOpenIds.includes(sessionId)) {
        if (isMaximized) setSavedLayout(null);
        setMosaicLayout(prev => {
          if (!prev) return sessionId;
          return {
            type: 'split',
            direction: 'row',
            children: [prev, sessionId],
            splitPercentages: [50, 50],
          };
        });
      }
      setActiveTerminalId(sessionId);
      setSidebarOpen(false);
      return;
    }

    if (visibleSessionIds.has(sessionId)) {
      handleCloseTile(sessionId);
      return;
    }
    if (isMaximized) {
      setSavedLayout(null);
    }
    setMosaicLayout(prev => {
      if (!prev) return sessionId;
      return {
        type: 'split',
        direction: 'row',
        children: [prev, sessionId],
        splitPercentages: [50, 50],
      };
    });
  }

  async function handleSync() {
    if (servers.length === 0) return;
    const results = await Promise.allSettled(
      servers.map(srv => syncSessions(srv.id))
    );
    const failed = results
      .map((r, i) => r.status === 'rejected' ? servers[i] : null)
      .filter(Boolean);
    await fetchSessions();
    if (failed.length) {
      toast.error(t('toast.syncPartial', {
        names: failed.map(s => s.name || `${s.host}:${s.port}`).join(', '),
      }));
    } else {
      toast.success(t('toast.syncDone'));
    }
  }

  async function handleRename(id, newName) {
    const { serverId } = splitSessionId(id);
    try {
      const data = await renameSession(id, newName);
      if (!servers.some(s => s.id === serverId)) return;
      const session = decorateSession(data.session, serverId);
      setSessions(prev => prev.map(s => s.id === id ? session : s));
    } catch (err) {
      showError(err);
    }
  }

  function decorateSession(rawSession, serverId) {
    const srv = servers.find(s => s.id === serverId);
    return {
      ...rawSession,
      id: composeSessionId(serverId, rawSession.id),
      server_id: serverId,
      server_name: srv?.name,
      server_color: srv?.color,
    };
  }

  async function handleCreate(serverId, name, groupId) {
    if (!serverId) return;
    try {
      const data = await createSession(serverId, name, groupId);
      const session = decorateSession(data.session, serverId);
      setSessions(prev => [...prev, session]);
      // A successful mutation proves the server is online — if it had been
      // marked offline by an earlier race-y fetch, the snapshot effect would
      // otherwise skip this server and sessions.json would never record the
      // new session (it skips every srv in offlineServerIds).
      setOfflineServerIds(prev => prev.filter(id => id !== serverId));
      setMosaicLayout(prev => {
        if (!prev) return session.id;
        return {
          type: 'split',
          direction: 'row',
          children: [prev, session.id],
          splitPercentages: [50, 50],
        };
      });
      if (isMobile) setActiveTerminalId(session.id);
    } catch (err) {
      showError(err);
    }
  }

  async function handleKill(id) {
    try {
      await killSession(id);
      destroyTerminal(id);
      setSessions(prev => prev.filter(s => s.id !== id));
      setMosaicLayout(prev => prev ? removeFromTree(prev, id) : prev);
    } catch (err) {
      showError(err);
    }
  }

  function handleSessionEnded(id) {
    destroyTerminal(id);
    setSessions(prev => prev.filter(s => s.id !== id));
    setMosaicLayout(prev => prev ? removeFromTree(prev, id) : prev);
    toast(t('toast.sessionEnded'), { icon: '🔌' });
  }

  async function handleSplit(sourceSessionId, direction) {
    if (busySessionIds.has(sourceSessionId)) return;
    const { serverId } = splitSessionId(sourceSessionId);
    if (!serverId) return;
    setBusySessionIds(prev => new Set(prev).add(sourceSessionId));
    try {
      const data = await cloneSession(sourceSessionId);
      const session = decorateSession(data.session, serverId);
      setSessions(prev => [...prev, session]);
      // Successful clone = server is online (see handleCreate for rationale).
      setOfflineServerIds(prev => prev.filter(id => id !== serverId));
      setMosaicLayout(prev =>
        replaceInTree(prev, sourceSessionId, {
          type: 'split',
          direction,
          children: [sourceSessionId, session.id],
          splitPercentages: [50, 50],
        })
      );
      if (isMobile) setActiveTerminalId(session.id);
    } catch (err) {
      showError(err);
    } finally {
      setBusySessionIds(prev => { const next = new Set(prev); next.delete(sourceSessionId); return next; });
    }
  }

  const handleSplitH = (id) => handleSplit(id, 'row');
  const handleSplitV = (id) => handleSplit(id, 'column');

  function handleMaximize(sessionId) {
    if (isMaximized) {
      setMosaicLayout(savedLayout);
      setSavedLayout(null);
    } else {
      setSavedLayout(mosaicLayout);
      setMosaicLayout(sessionId);
    }
  }

  function handleReconnect() {
    destroyAllTerminals();
    setReconnectKey(prev => prev + 1);
    toast.success(t('toast.reconnecting'));
  }

  const handleReconnectRef = useRef(handleReconnect);
  handleReconnectRef.current = handleReconnect;

  useEffect(() => {
    const BACKOFF = [2000, 5000, 15000, 30000, 60000];
    let scheduled = false;
    let attempt = 0;
    const trigger = () => {
      if (scheduled) return;
      if (!hasDeadConnections()) { attempt = 0; return; }
      scheduled = true;
      const delay = BACKOFF[Math.min(attempt, BACKOFF.length - 1)];
      setTimeout(() => { scheduled = false; }, delay);
      attempt += 1;
      handleReconnectRef.current?.();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        attempt = 0;
        trigger();
        setTimeout(trigger, 500);
      }
    };
    const onPageShow = (e) => {
      if (e.persisted) { attempt = 0; trigger(); }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, []);

  function handleCloseTile(sessionId) {
    setMosaicLayout(prev => prev ? removeFromTree(prev, sessionId) : prev);
  }

  function handleMobileClose(sessionId) {
    handleCloseTile(sessionId);
  }

  async function handleToggleNotify(sessionId, value) {
    const prev = sessions;
    setSessions(p => p.map(s => s.id === sessionId ? { ...s, notify_on_idle: value } : s));
    try {
      await setSessionNotify(sessionId, value);
    } catch (err) {
      setSessions(prev);
      showError(err);
    }
  }

  async function handleAssignGroup(sessionId, groupId) {
    const prevSessions = sessions;
    setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, group_id: groupId } : s));
    try {
      await assignSessionGroup(sessionId, groupId);
    } catch (err) {
      setSessions(prevSessions);
      showError(err);
    }
  }

  async function handleRequestCompose(sessionId) {
    if (composeLoadingId) return;
    setComposeLoadingId(sessionId);
    try {
      const data = await getComposeDrafts();
      setComposeDrafts(data?.drafts || {});
    } catch (err) {
      console.warn('[getComposeDrafts] refresh failed', err);
    } finally {
      setComposeLoadingId(null);
    }
    setComposeTargetId(sessionId);
  }

  const handleDraftPersist = useCallback((compositeId, rawText) => {
    if (!compositeId) return;
    const text = typeof rawText === 'string' ? rawText : '';
    const trimmed = text.trim();
    setComposeDrafts(prev => {
      const next = { ...prev };
      if (!trimmed) {
        if (!(compositeId in next)) return prev;
        delete next[compositeId];
      } else {
        const cur = next[compositeId];
        if (cur && cur.text === text) return prev;
        next[compositeId] = { text, updated_at: new Date().toISOString() };
      }
      putComposeDrafts({ drafts: next }).catch(err =>
        console.warn('[setComposeDrafts] persist failed', err)
      );
      return next;
    });
  }, []);

  function handleComposeSend(text, sendEnter) {
    const sid = composeTargetId;
    if (!sid) { setComposeTargetId(null); return; }
    sendKey(sid, '\x03');
    setTimeout(() => {
      if (text) sendKey(sid, text);
      if (sendEnter) sendKey(sid, '\r');
    }, 50);
    handleDraftPersist(sid, '');
    setComposeTargetId(null);
  }

  async function handleComposeSaveAsPrompt({ name, body }) {
    try {
      const data = await createPrompt({ name, body });
      toast.success(t(data.detail_key));
    } catch (err) {
      showError(err);
      throw err;
    }
  }

  async function handleReorderGroups(fromId, toId) {
    const next = reorderById(groups, fromId, toId);
    if (next === groups) return;
    const prev = groups;
    setGroups(next);
    try {
      await saveGroups(next);
    } catch (err) {
      setGroups(prev);
      showError(err);
    }
  }

  async function handleHideGroup(groupId) {
    const prevGroups = groups;
    setGroups(prev => prev.map(g => g.id === groupId ? { ...g, hidden: true } : g));
    try {
      await setGroupHidden(groupId, true);
      toast.success(t('groupSelector.hidden'));
    } catch (err) {
      setGroups(prevGroups);
      showError(err);
    }
  }

  async function handleCreateGroupInline(name) {
    try {
      const data = await createGroup(name);
      setGroups(prev => [...prev, data.group]);
      return data.group;
    } catch (err) {
      showError(err);
      throw err;
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className={`flex flex-1 min-h-0 overflow-hidden relative ${isMobile ? 'pl-12' : ''}`}>

        {isMobile && sidebarOpen && (
          <div
            className="sidebar-backdrop absolute inset-0 z-30 bg-overlay/60"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <Sidebar
          sessions={sessionsInSelectedGroup}
          allSessions={sessions}
          groups={groups}
          servers={servers}
          offlineServerIds={offlineServerIds}
          onCreateSession={handleCreate}
          onKillSession={handleKill}
          onRenameSession={handleRename}
          onSync={handleSync}
          onReconnect={handleReconnect}
          onAssignGroup={handleAssignGroup}
          onCreateGroupInline={handleCreateGroupInline}
          isOpen={sidebarOpen}
          onToggle={() => setSidebarOpen(prev => !prev)}
          isMobile={isMobile}
          visibleSessionIds={visibleSessionIds}
          onSelectSession={handleSelectSession}
          activeTerminalId={activeTerminalId}
          onToggleNotify={handleToggleNotify}
          onRequestCompose={handleRequestCompose}
          composeLoadingId={composeLoadingId}
          selectedGroupId={selectedGroupId}
          defaultCreateGroupId={selectedGroupId}
        />

        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          <GroupSelector
            groups={groups}
            sessions={sessions}
            selectedGroupId={selectedGroupId}
            onSelect={setSelectedGroupId}
            onHideGroup={handleHideGroup}
            onReorder={handleReorderGroups}
            onGroupsChanged={fetchGroups}
            isMobile={isMobile}
          />
          <TerminalMosaic
          key={reconnectKey}
          sessions={sessionsInSelectedGroup}
          layout={mosaicLayout}
          onLayoutChange={setMosaicLayout}
          onSplitH={handleSplitH}
          onSplitV={handleSplitV}
          onClose={handleCloseTile}
          onMaximize={handleMaximize}
          isMaximized={isMaximized}
          onSessionEnded={handleSessionEnded}
          busySessionIds={busySessionIds}
          onTileDragStart={setDraggingId}
          onTileDragEnd={() => setDraggingId(null)}
          isMobile={isMobile}
          activeTerminalId={activeTerminalId}
          onActiveTerminalChange={setActiveTerminalId}
          mobileOpenIds={mobileOpenIds}
          onMobileClose={handleMobileClose}
        />
        </div>
      </div>

      {isMobile && (
        <div style={{ background: 'hsl(var(--sidebar-bg))' }}>
          <MobileKeyBar
            sessionId={activeTerminalId}
          />
        </div>
      )}

      {composeTargetId && (
        <ComposeModal
          sessionName={sessions.find(s => s.id === composeTargetId)?.name}
          initialValue={composeDrafts[composeTargetId]?.text || ''}
          sessionCompositeId={composeTargetId}
          onDraftPersist={handleDraftPersist}
          onSend={handleComposeSend}
          onSaveAsPrompt={handleComposeSaveAsPrompt}
          onClose={() => setComposeTargetId(null)}
        />
      )}
    </div>
  );
}
