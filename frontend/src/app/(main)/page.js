'use client';

import { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import {
  getSessions, createSession, killSession, renameSession, cloneSession,
  getGroups, createGroup, assignSessionGroup, setGroupHidden, saveGroups, setSessionNotify, createPrompt,
  composeSessionId, splitSessionId,
  getSessionsSnapshot, setSessionsSnapshot, restoreSessions,
  getComposeDrafts, setComposeDrafts as putComposeDrafts,
  addRecentCwd, sendTextToSession,
} from '@/services/api';
import { ssRead, ssWrite, ssRemove, ssListKeysWithPrefix } from '@/lib/sessionState';
import { cleanupLegacyKeys } from '@/lib/legacyCleanup';
import { reorderById } from '@/utils/reorder';
import { replaceInTree, removeFromTree, getVisibleSessionIds, validateTree, insertSession, normalizeMosaicTree } from '@/utils/mosaicHelpers';
import { destroyTerminal, destroyAllTerminals, hasDeadConnections, probeAllTerminals, isTerminalConnected } from '@/components/TerminalPane';
import { useTranslation, useErrorToast } from '@/providers/I18nProvider';
import { useServers } from '@/providers/ServersProvider';
import { useProjects } from '@/providers/ProjectsProvider';
import { useViewState } from '@/providers/ViewStateProvider';
import { useIsMobile } from '@/hooks/layout';
import dynamic from 'next/dynamic';
import Sidebar from '@/components/Sidebar';
import GroupSelector from '@/components/GroupSelector';
import ComposeModal from '@/components/ComposeModal';
import VoiceCommandModal from '@/components/VoiceCommandModal';
import MobileKeyBar from '@/components/MobileKeyBar';
import TlsAcceptModal from '@/components/TlsAcceptModal';
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
  const { servers, loading: serversLoading, loaded: serversLoaded } = useServers();
  const { activeProjectId, activeProject } = useProjects();
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
  const snapshotInFlight = useRef(Promise.resolve());
  const composeDraftsInFlight = useRef(Promise.resolve());
  const latestLayoutsRef = useRef({});
  const previousLayoutsRef = useRef({});
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
  const [voiceTargetId, setVoiceTargetId] = useState(null);

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
    cleanupLegacyKeys();
    const prefix = 'rt:layout::';
    const keys = ssListKeysWithPrefix(prefix);
    const normalized = {};
    for (const fullKey of keys) {
      const inner = fullKey.slice(prefix.length);
      const value = ssRead(fullKey, null);
      let raw;
      if (value && typeof value === 'object' && !Array.isArray(value) && 'mosaic' in value) {
        raw = value.mosaic ?? null;
      } else {
        raw = value ?? null;
      }
      // Layouts persistidos antes da normalização entrar podem estar no
      // formato customizado {type, children, splitPercentages}. Normalizar
      // aqui evita o bug do "terceiro terminal somem" assim que a árvore
      // mistura formatos.
      normalized[inner] = raw ? normalizeMosaicTree(raw) : raw;
    }
    previousLayoutsRef.current = { ...normalized };
    setMosaicLayouts(normalized);
    setHydratedLayouts(true);
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

  const flushLayoutsToStorage = useCallback(() => {
    const next = latestLayoutsRef.current || {};
    const prev = previousLayoutsRef.current || {};
    for (const [innerKey, value] of Object.entries(next)) {
      if (prev[innerKey] === value) continue;
      ssWrite(`rt:layout::${innerKey}`, value);
    }
    for (const innerKey of Object.keys(prev)) {
      if (innerKey in next) continue;
      ssRemove(`rt:layout::${innerKey}`);
    }
    previousLayoutsRef.current = { ...next };
  }, []);

  useEffect(() => {
    if (!hydratedLayouts) return;
    latestLayoutsRef.current = mosaicLayouts;
    if (layoutsSaveTimer.current) clearTimeout(layoutsSaveTimer.current);
    layoutsSaveTimer.current = setTimeout(() => {
      layoutsSaveTimer.current = null;
      flushLayoutsToStorage();
    }, 500);
    return () => { if (layoutsSaveTimer.current) clearTimeout(layoutsSaveTimer.current); };
  }, [mosaicLayouts, hydratedLayouts, flushLayoutsToStorage]);

  useEffect(() => {
    return () => {
      if (layoutsSaveTimer.current) {
        clearTimeout(layoutsSaveTimer.current);
        layoutsSaveTimer.current = null;
        flushLayoutsToStorage();
      }
    };
  }, [flushLayoutsToStorage]);

  // Gate every effect/derivation that mutates or reads mosaicLayouts/selectedGroupId
  // against an inconsistent project snapshot (activeProjectId has flipped but sessions
  // or groups haven't caught up yet). Any new effect touching layouts or group state
  // should bail on `!projectDataReady`.
  // `serversLoaded` é parte do gate porque, na transição /login → /, o ServersProvider
  // ficou com loading=false e servers=[] (último estado em /login). Page.js mounta,
  // seu effect de fetch vê serversLoading=false, dispara fetchSessions/fetchGroups que
  // short-circuitam em servers.length===0, setam hydratedSessions/Groups=true com listas
  // vazias. Quando ServersProvider depois carrega de verdade, projectDataReady viraria
  // true (servers populado, hidratos true) com sessions/groups ainda vazios — e a
  // validação de tree concluiria que os terminais são órfãos, zerando o mosaico.
  // `serversLoaded` só vira true depois do primeiro load() real do provider concluir.
  const projectDataReady = hydrated && hydratedLayouts && hydratedSessions && hydratedGroups
    && sessionsProjectId === activeProjectId
    && groupsProjectId === activeProjectId
    && serversLoaded;

  useEffect(() => {
    if (!projectDataReady) return;
    if (selectedGroupId === null) return;
    const match = groups.find(g => g.id === selectedGroupId);
    if (!match || match.hidden) {
      setSelectedGroupId(null);
    }
  }, [groups, selectedGroupId, projectDataReady, setSelectedGroupId]);

  const sessionsInSelectedGroup = useMemo(() => {
    const validGroupIds = new Set(groups.map(g => g.id));
    return sessions.filter(s => {
      const gid = s.group_id && validGroupIds.has(s.group_id) ? s.group_id : null;
      return gid === selectedGroupId;
    });
  }, [sessions, groups, selectedGroupId]);

  const groupKey = `${activeProjectId}::${selectedGroupId ?? '__none__'}`;
  const mosaicLayout = projectDataReady ? (mosaicLayouts[groupKey] ?? null) : null;

  const setMosaicLayout = useCallback((updater) => {
    setMosaicLayouts(prev => {
      const key = `${activeProjectId}::${selectedGroupId ?? '__none__'}`;
      const cur = prev[key] ?? null;
      const raw = typeof updater === 'function' ? updater(cur) : updater;
      // Normaliza qualquer árvore antes de persistir, independente da fonte
      // (react-mosaic onChange, insertSession, replaceInTree, validateTree).
      // Mantém o estado em um único formato canônico e elimina tiles sumidos
      // por nós com filho ausente.
      const next = raw === cur ? cur : normalizeMosaicTree(raw);
      if (next === cur) return prev;
      return { ...prev, [key]: next };
    });
  }, [selectedGroupId, activeProjectId]);

  const mobileOpenIds = useMemo(() => Array.from(getVisibleSessionIds(mosaicLayout)), [mosaicLayout]);

  useEffect(() => {
    if (!projectDataReady) return;
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
  }, [sessions, groups, projectDataReady, activeProjectId]);

  useEffect(() => {
    if (!projectDataReady) return;
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
  }, [groups, projectDataReady, activeProjectId]);

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
      // NÃO seta hydratedSessions=true. Semântica: "fetch real bem-sucedida com
      // servers populados". Sem servers, não há fetch confiável; deixar false impede
      // que projectDataReady vire true com sessions=[] de short-circuit — o que
      // faria a validação zerar tiles do mosaico achando que são órfãos durante a
      // janela /login → / antes do ServersProvider terminar de carregar.
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
      // Mesmo motivo do fetchSessions short-circuit: não setar hydratedGroups=true.
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
    fetchSessions();
    fetchGroups();
  }, [serversLoading, servers, fetchSessions, fetchGroups]);

  useEffect(() => {
    if (!hydratedSessions) return;
    if (sessionsProjectId !== activeProjectId) return;
    if (servers.length === 0) return;

    if (snapshotDebounceRef.current) clearTimeout(snapshotDebounceRef.current);
    snapshotDebounceRef.current = setTimeout(() => {
      snapshotInFlight.current = snapshotInFlight.current
        .catch(() => {})
        .then(async () => {
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
              // Sempre persiste um label legível pra notificação manter o
              // formato "{projeto} › {grupo} › {terminal}" após restore.
              group_name: s.group_name || t('sidebar.noGroup'),
              notify_on_idle: Boolean(s.notify_on_idle),
              cwd: s.cwd || null,
              created_at: s.created_at,
              project_id: s.project_id || activeProjectId,
              project_name: s.project_name || activeProject?.name || t('projects.defaultName'),
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
        })
        .catch(err => console.warn('[sessionsSnapshot] persist failed', err));
    }, 500);
  }, [sessions, offlineServerIds, hydratedSessions, servers, activeProjectId, activeProject, sessionsProjectId]);

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
    composeDraftsInFlight.current = composeDraftsInFlight.current
      .catch(() => {})
      .then(() => putComposeDrafts({ drafts: next }))
      .catch(err => console.warn('[setComposeDrafts] cleanup failed', err));
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
      setMosaicLayout(prev => insertSession(prev, sid));
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
        setMosaicLayout(prev => insertSession(prev, sessionId));
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
    setMosaicLayout(prev => insertSession(prev, sessionId));
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

  async function handleCreate(serverId, name, groupId, cwd) {
    if (!serverId) return;
    try {
      const group = groupId ? groups.find(g => g.id === groupId) : null;
      const data = await createSession(serverId, name, groupId, cwd, {
        groupName: group?.name || t('sidebar.noGroup'),
        projectName: activeProject?.name || t('projects.defaultName'),
      });
      const session = decorateSession(data.session, serverId);
      setSessions(prev => [...prev, session]);
      // A successful mutation proves the server is online — if it had been
      // marked offline by an earlier race-y fetch, the snapshot effect would
      // otherwise skip this server and sessions.json would never record the
      // new session (it skips every srv in offlineServerIds).
      setOfflineServerIds(prev => prev.filter(id => id !== serverId));
      setMosaicLayout(prev => insertSession(prev, session.id));
      if (isMobile) setActiveTerminalId(session.id);
      // Fire-and-forget: persist this cwd as a recent for the dropdown next
      // time the user opens the modal. Failure to persist doesn't undo the
      // created terminal — log and move on.
      if (cwd) {
        addRecentCwd(serverId, cwd).catch(err => {
          console.warn('addRecentCwd failed:', err);
        });
      }
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
          direction,
          first: sourceSessionId,
          second: session.id,
          splitPercentage: 50,
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
        // Probe ativo: WS pode estar zumbi (readyState=OPEN mas TCP morto).
        // Comum em mobile após tab freeze e em desktop após suspend/Wi-Fi flap.
        // hasDeadConnections() sozinho não detecta isso e o trigger acima sai
        // sem reconectar.
        probeAllTerminals(2000).then((anyDead) => {
          if (anyDead) handleReconnectRef.current?.();
        });
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
    const group = groupId ? groups.find(g => g.id === groupId) : null;
    // Sempre grava um label legível (mesmo "Sem grupo") pra notificação ficar
    // consistente "{projeto} › {grupo} › {terminal}", sem omitir partes.
    const groupName = group?.name || t('sidebar.noGroup');
    setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, group_id: groupId, group_name: groupName } : s));
    try {
      await assignSessionGroup(sessionId, groupId, groupName);
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
      composeDraftsInFlight.current = composeDraftsInFlight.current
        .catch(() => {})
        .then(() => putComposeDrafts({ drafts: next }))
        .catch(err => console.warn('[setComposeDrafts] persist failed', err));
      return next;
    });
  }, []);

  async function handleComposeSend(text, sendEnter) {
    const sid = composeTargetId;
    if (!sid) { setComposeTargetId(null); return false; }
    if (!isTerminalConnected(sid)) {
      toast.error(t('terminal.actions.disconnected'));
      return false;
    }
    try {
      await sendTextToSession(sid, text || '', !!sendEnter);
    } catch (err) {
      showError(err);
      return false;
    }
    handleDraftPersist(sid, '');
    setComposeTargetId(null);
    return true;
  }

  function handleRequestVoice(sessionId) {
    if (!isTerminalConnected(sessionId)) {
      toast.error(t('terminal.actions.disconnected'));
      return;
    }
    setVoiceTargetId(sessionId);
  }

  async function handleVoiceSend(text, sendEnter) {
    const sid = voiceTargetId;
    if (!sid) { setVoiceTargetId(null); return false; }
    if (!isTerminalConnected(sid)) {
      toast.error(t('terminal.actions.disconnected'));
      return false;
    }
    try {
      await sendTextToSession(sid, text || '', !!sendEnter);
    } catch (err) {
      showError(err);
      return false;
    }
    setVoiceTargetId(null);
    return true;
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
          onReconnect={handleReconnect}
          busySessionIds={busySessionIds}
          onTileDragStart={setDraggingId}
          onTileDragEnd={() => setDraggingId(null)}
          isMobile={isMobile}
          activeTerminalId={activeTerminalId}
          onActiveTerminalChange={setActiveTerminalId}
          mobileOpenIds={mobileOpenIds}
          onMobileClose={handleMobileClose}
          onToggleNotify={handleToggleNotify}
          onRequestCompose={handleRequestCompose}
          composeLoadingId={composeLoadingId}
          onRequestVoice={handleRequestVoice}
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

      {voiceTargetId && (
        <VoiceCommandModal
          sessionName={sessions.find(s => s.id === voiceTargetId)?.name}
          onSend={handleVoiceSend}
          onClose={() => setVoiceTargetId(null)}
        />
      )}

      <TlsAcceptModal
        servers={servers}
        offlineServerIds={offlineServerIds}
        onRetest={fetchSessions}
      />
    </div>
  );
}
