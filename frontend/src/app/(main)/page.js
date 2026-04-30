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
import {
  destroyTerminal, destroyAllTerminals, destroyTerminalsByServerId,
  getDeadConnectionServerIds, probeDeadConnectionServerIds, isTerminalConnected,
} from '@/components/TerminalPane';
import { useTranslation, useErrorToast } from '@/providers/I18nProvider';
import { useServers } from '@/providers/ServersProvider';
import { useServerHealth, SERVER_HEALTH_STATUS } from '@/providers/ServerHealthProvider';
import { useProjects } from '@/providers/ProjectsProvider';
import { useViewState } from '@/providers/ViewStateProvider';
import { useIsMobile } from '@/hooks/layout';
import dynamic from 'next/dynamic';
import Sidebar from '@/components/Sidebar';
import WorkspaceContextBar from '@/components/WorkspaceContextBar';
import ComposeModal from '@/components/ComposeModal';
import VoiceCommandModal from '@/components/VoiceCommandModal';
import MobileKeyBar from '@/components/MobileKeyBar';
import TlsAcceptModal from '@/components/TlsAcceptModal';
import ServerBootGateModal from '@/components/ServerBootGateModal';
import { buildSettingsTargetUrl } from '@/lib/serverBootGate';
const TerminalMosaic = dynamic(() => import('@/components/TerminalMosaic'), { ssr: false });

const EMPTY_ARRAY = [];

const EMPTY_SERVER_GATE = {
  visible: false,
  checking: false,
  checked: false,
  total: 0,
  onlineCount: 0,
  results: [],
};

const INITIAL_SERVER_GATE = {
  ...EMPTY_SERVER_GATE,
  visible: true,
  checking: true,
};

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
  const {
    health: serverHealth,
    markServerOnline,
    markServerOffline,
    retryServer,
  } = useServerHealth();
  const { activeProjectId, activeProject } = useProjects();
  const { getProjectGroup, setProjectGroup, hydrated: hydratedViewState } = useViewState();
  const router = useRouter();
  const searchParams = useSearchParams();
  const handledSessionRef = useRef(null);
  const [sessions, setSessions] = useState([]);
  const [groups, setGroups] = useState([]);
  const [offlineServerIds, setOfflineServerIds] = useState([]);
  const [serverGate, setServerGate] = useState(INITIAL_SERVER_GATE);
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
  const sessionsRef = useRef([]);
  const offlineServerIdsRef = useRef([]);
  // Per-server tracking: cada serverId entra no Set assim que seu restore
  // inicial sucede (ou é confirmado como vazio). Antes era um boolean global
  // — qualquer falha (ex: server B offline) deixava o gate aberto e mudanças
  // em `sessions[]` re-disparavam o efeito de restore com snapshot stale,
  // ressuscitando sessões deletadas em outros servers.
  const restoreAttemptedRef = useRef(new Set());
  const restoreRetryTimerRef = useRef(null);
  const restoreInFlightRef = useRef(new Set());
  const restoreBlockedServerIdsRef = useRef(new Set());
  const forceRestoreInFlightRef = useRef(new Set());
  const killedSessionTombstonesRef = useRef(new Map());
  // Epoch counter pra descartar respostas obsoletas: se o usuário troca de
  // projeto/server enquanto uma fetch está em curso, comparamos runId no
  // handler de cada server e ignoramos updates de fetches superadas.
  const fetchRunIdRef = useRef(0);
  const fetchSessionsInFlightRef = useRef(null);
  const fetchSessionsQueuedRef = useRef(null);
  const serverReconnectCooldownRef = useRef(new Map());
  // Epoch independente pra fetchGroups: grupos vêm do dashboard local
  // (/api/groups), não dos servers, então rodam mesmo com servers=[]. O
  // contador descarta respostas atrasadas de troca de projeto.
  const fetchGroupsRunIdRef = useRef(0);
  // Espelho de groupsProjectId pra detectar troca de projeto sem adicionar
  // groupsProjectId às deps de fetchGroups (evita loop de useCallback).
  const groupsProjectIdRef = useRef(null);
  // Espelho de activeProjectId pra handlers async checarem se o usuário
  // trocou de projeto enquanto a request estava em voo.
  const activeProjectIdRef = useRef(null);
  const serverGateRef = useRef(INITIAL_SERVER_GATE);
  const lastBlockingLoadKeyRef = useRef(null);
  const [busySessionIds, setBusySessionIds] = useState(new Set());
  const [draggingId, setDraggingId] = useState(null);
  const [reconnectKey, setReconnectKey] = useState(0);
  // serverId -> contador incremental. Usado como sufixo na key do TerminalPane
  // pra forçar remount somente dos panes do server que precisa reconectar
  // (em vez de remontar todo o TerminalMosaic via reconnectKey global).
  const [serverReconnectKeys, setServerReconnectKeys] = useState({});
  const [restoreRetryKey, setRestoreRetryKey] = useState(0);
  const [serversPreparingRestore, setServersPreparingRestore] = useState(new Set());
  const [serversNeedingRestore, setServersNeedingRestore] = useState(new Set());
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

  const scheduleRestoreRetry = useCallback(() => {
    if (restoreRetryTimerRef.current) return;
    restoreRetryTimerRef.current = setTimeout(() => {
      restoreRetryTimerRef.current = null;
      setRestoreRetryKey(k => k + 1);
    }, 3000);
  }, []);

  const restoreBlockedServerIds = useMemo(() => {
    const next = new Set(serversPreparingRestore);
    for (const serverId of serversNeedingRestore) next.add(serverId);
    return next;
  }, [serversPreparingRestore, serversNeedingRestore]);

  const clearRestoreBarrierForServers = useCallback((serverIds) => {
    const ids = new Set((serverIds || []).filter(Boolean));
    if (ids.size === 0) return;

    restoreBlockedServerIdsRef.current = new Set(
      [...restoreBlockedServerIdsRef.current].filter((id) => !ids.has(id))
    );
    setServersPreparingRestore(prev => {
      let changed = false;
      const next = new Set(prev);
      for (const id of ids) {
        if (next.delete(id)) changed = true;
      }
      return changed ? next : prev;
    });
    setServersNeedingRestore(prev => {
      let changed = false;
      const next = new Set(prev);
      for (const id of ids) {
        if (next.delete(id)) changed = true;
      }
      return changed ? next : prev;
    });
    setOfflineServerIds(prev => prev.filter((id) => !ids.has(id)));
  }, []);

  // Espelha o efeito de persist debounce (linhas ~636-680) para um único
  // server, mas síncrono. Usado no caminho de restart (markServerForRestore)
  // e no de delete (handleKill) para garantir que o snapshot reflete o
  // estado atual de `sessions[]` ANTES do restore poll consumir o snapshot
  // de disco. Sem isso, mudanças recentes (criação de Y antes do restart,
  // delete de term-1 enquanto outro server B está offline) ficavam fora do
  // snapshot e ou eram perdidas (Y) ou ressuscitavam (term-1).
  //
  // `sessionsOverride` permite ao caller passar uma lista que ainda não
  // chegou ao state do hook — necessário em handleKill, onde setSessions
  // agendou o filter mas a closure de `sessions` aqui ainda enxerga o
  // estado pré-delete.
  const persistSnapshotForServer = useCallback(async (serverId, sessionsOverride) => {
    if (!hydratedSessions || !serverId) return;
    const sessionsArr = sessionsOverride || sessions;
    const current = await getSessionsSnapshot().catch(() => null);
    const mergedServers = { ...(current?.servers || {}) };
    const liveForServer = sessionsArr
      .filter((s) => splitSessionId(s.id).serverId === serverId)
      .map((s) => ({
        id: splitSessionId(s.id).sessionId,
        name: s.name,
        group_id: s.group_id || null,
        group_name: s.group_name || t('sidebar.noGroup'),
        notify_on_idle: Boolean(s.notify_on_idle),
        cwd: s.cwd || null,
        created_at: s.created_at,
        project_id: s.project_id || activeProjectId,
        project_name: s.project_name || activeProject?.name || t('projects.defaultName'),
      }));
    const existing = Array.isArray(mergedServers[serverId]) ? mergedServers[serverId] : [];
    const otherProjects = existing.filter((s) => s && s.project_id && s.project_id !== activeProjectId);
    mergedServers[serverId] = [...otherProjects, ...liveForServer];
    await setSessionsSnapshot({ servers: mergedServers });
  }, [hydratedSessions, sessions, activeProjectId, activeProject, t]);

  const markServerForRestore = useCallback(async (serverId) => {
    if (!serverId) return;
    if (restoreBlockedServerIdsRef.current.has(serverId)) return;
    if (forceRestoreInFlightRef.current.has(serverId)) return;
    forceRestoreInFlightRef.current.add(serverId);
    restoreBlockedServerIdsRef.current = new Set([...restoreBlockedServerIdsRef.current, serverId]);
    setServersPreparingRestore(prev => {
      if (prev.has(serverId)) return prev;
      const next = new Set(prev);
      next.add(serverId);
      return next;
    });

    // Flush sincronizado: cancela debounce pendente e persiste o snapshot
    // do server agora, com o estado de `sessions[]` que ainda contém as
    // sessões recém-criadas. Encadeia atrás de qualquer persist em voo
    // pra não competir com escrita simultânea.
    //
    // Carve-out crítico: só flushamos quando `sessions[]` realmente tem
    // entries do server-alvo. Quando markServerForRestore é re-disparado
    // por um WS close 4004 logo após o backend voltar (race comum em LAN
    // com restart < 1s), `fetchSessions` pode ter acabado de zerar
    // `sessions[]` porque o backend ainda não restaurou as PTYs. Flushar
    // nesse momento escreveria snapshot[server] = [otherProjects, ...empty]
    // — apagando do disco exatamente as sessões do projeto ativo que
    // estamos tentando restaurar. O snapshot existente já tem o estado
    // correto (do primeiro flush ou do dia anterior); preservamos.
    const hasLiveForServer = sessions.some((s) => splitSessionId(s.id).serverId === serverId);
    if (hasLiveForServer) {
      if (snapshotDebounceRef.current) {
        clearTimeout(snapshotDebounceRef.current);
        snapshotDebounceRef.current = null;
      }
      snapshotInFlight.current = snapshotInFlight.current
        .catch(() => {})
        .then(() => persistSnapshotForServer(serverId));
      await snapshotInFlight.current.catch((err) => console.warn('[markServerForRestore] persist failed', err));
    }

    restoreAttemptedRef.current.delete(serverId);
    setServersPreparingRestore(prev => {
      if (!prev.has(serverId)) return prev;
      const next = new Set(prev);
      next.delete(serverId);
      return next;
    });
    setServersNeedingRestore(prev => {
      if (prev.has(serverId)) return prev;
      const next = new Set(prev);
      next.add(serverId);
      return next;
    });
    setOfflineServerIds(prev => prev.includes(serverId) ? prev : [...prev, serverId]);
    // Também marca offline no ServerHealthProvider. Sem isso, o auto-recovery
    // effect (que compara wasOffline → isOnline em `serverHealth`) nunca
    // detecta o flip quando o backend volta, então `fetchSessions` não é
    // disparado e a única tentativa de reconexão é via `scheduleRestoreRetry`
    // com setTimeout — que pode demorar (3s mínimo) ou ficar preso. Marcar
    // offline aqui agenda um backoff explícito de 5s no health provider:
    // assim que o backend voltar, o ping detecta ONLINE, o auto-recovery
    // dispara e o restore reidrata as sessões sem depender do retry interno.
    markServerOffline(serverId, 'restart');
    setRestoreRetryKey(k => k + 1);
    forceRestoreInFlightRef.current.delete(serverId);
  }, [persistSnapshotForServer, sessions, markServerOffline]);

  useEffect(() => { groupsProjectIdRef.current = groupsProjectId; }, [groupsProjectId]);
  useEffect(() => { activeProjectIdRef.current = activeProjectId; }, [activeProjectId]);
  useEffect(() => { serverGateRef.current = serverGate; }, [serverGate]);
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);
  useEffect(() => { offlineServerIdsRef.current = offlineServerIds; }, [offlineServerIds]);
  useEffect(() => { restoreBlockedServerIdsRef.current = restoreBlockedServerIds; }, [restoreBlockedServerIds]);

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

  // Render-safe slices: state updates from a previous project can still be in
  // memory until the fetch effects run after paint. Never derive visible UI
  // from those stale arrays while the project ids are catching up.
  const groupsForDisplay = groupsProjectId === activeProjectId ? groups : EMPTY_ARRAY;
  const sessionsForDisplay = sessionsProjectId === activeProjectId ? sessions : EMPTY_ARRAY;

  useEffect(() => {
    if (!projectDataReady) return;
    if (selectedGroupId === null) return;
    const match = groupsForDisplay.find(g => g.id === selectedGroupId);
    if (!match || match.hidden) {
      setSelectedGroupId(null);
    }
  }, [groupsForDisplay, selectedGroupId, projectDataReady, setSelectedGroupId]);

  const sessionsInSelectedGroup = useMemo(() => {
    const validGroupIds = new Set(groupsForDisplay.map(g => g.id));
    return sessionsForDisplay.filter(s => {
      const gid = s.group_id && validGroupIds.has(s.group_id) ? s.group_id : null;
      return gid === selectedGroupId;
    });
  }, [sessionsForDisplay, groupsForDisplay, selectedGroupId]);

  // Filtro de servidor escopado ao projeto/grupo ativo — null = "All". Não
  // alimenta layout cleanup (`validateTree` segue usando sessionsInSelectedGroup
  // pra preservar tiles ocultos por filtro), só recorta o que o sidebar e o
  // mosaic exibem.
  const [selectedServerFilterId, setSelectedServerFilterId] = useState(null);

  // Reset do filtro quando o usuário troca de projeto. Servers de outro
  // projeto raramente fazem sentido e o filtro guarda só um id.
  useEffect(() => {
    setSelectedServerFilterId(null);
  }, [activeProjectId]);

  const sessionsVisibleInWorkspace = useMemo(() => {
    if (!selectedServerFilterId) return sessionsInSelectedGroup;
    return sessionsInSelectedGroup.filter(s => s.server_id === selectedServerFilterId);
  }, [sessionsInSelectedGroup, selectedServerFilterId]);

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

  const mosaicRenderLayout = useMemo(() => {
    if (!mosaicLayout) return mosaicLayout;
    const shouldValidateRenderLayout = Boolean(selectedServerFilterId)
      || offlineServerIds.length > 0
      || restoreBlockedServerIds.size > 0;
    if (!shouldValidateRenderLayout) return mosaicLayout;
    const validIds = new Set(sessionsVisibleInWorkspace.map(s => s.id));
    return validateTree(mosaicLayout, validIds);
  }, [mosaicLayout, selectedServerFilterId, sessionsVisibleInWorkspace, offlineServerIds, restoreBlockedServerIds]);

  const mobileOpenIds = useMemo(() => Array.from(getVisibleSessionIds(mosaicRenderLayout)), [mosaicRenderLayout]);

  useEffect(() => {
    if (!projectDataReady) return;
    if (offlineServerIds.length > 0 || restoreBlockedServerIds.size > 0) return;
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
  }, [sessions, groups, projectDataReady, activeProjectId, offlineServerIds, restoreBlockedServerIds]);

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

  const blockingLoadKey = useMemo(() => {
    if (!serversLoaded) return null;
    const serverKey = servers
      .map((s) => `${s.id}:${s.protocol || 'http'}:${s.host}:${s.port}:${s.apiKey || ''}`)
      .join('|');
    return `${activeProjectId}::${serverKey}`;
  }, [activeProjectId, servers, serversLoaded]);

  const fetchSessions = useCallback((options = {}) => {
    const queueOptions = (nextOptions = {}) => {
      const queued = fetchSessionsQueuedRef.current || {
        block: false,
        forceServerIds: new Set(),
        reasons: [],
      };
      queued.block = queued.block || Boolean(nextOptions.block);
      for (const id of nextOptions.forceServerIds || []) {
        if (id) queued.forceServerIds.add(id);
      }
      queued.reasons.push(nextOptions.reason || 'unspecified');
      fetchSessionsQueuedRef.current = queued;
    };

    if (fetchSessionsInFlightRef.current) {
      queueOptions(options);
      return fetchSessionsInFlightRef.current;
    }

    const runOnce = async (currentOptions = {}) => {
    const { block = false, forceServerIds = [], reason = 'unspecified' } = currentOptions;
    try {
      if (typeof window !== 'undefined' && window.localStorage?.getItem('rt:debugFetchSessions') === '1') {
        console.debug('[fetchSessions]', reason);
      }
    } catch {
      // Ignore storage access failures; debug logging must not affect fetches.
    }
    if (servers.length === 0) {
      setSessions([]);
      setOfflineServerIds([]);
      setSessionsProjectId(activeProjectId);
      // Com serversLoaded já true (gate no useEffect que dispara este callback),
      // servers=[] significa "dashboard configurado sem nenhum server" e não a
      // janela /login → / antes do ServersProvider carregar. Marcar hidratado
      // vazio aqui é seguro e necessário pra projectDataReady abrir.
      if (serversLoaded) setHydratedSessions(true);
      if (block) setServerGate(EMPTY_SERVER_GATE);
      return;
    }

    const runId = ++fetchRunIdRef.current;
    const projectId = activeProjectId;
    const forceServerSet = new Set(forceServerIds);
    const blockedServerIds = restoreBlockedServerIdsRef.current;
    const previousOfflineSet = new Set(offlineServerIdsRef.current);
    if (block) {
      setHydratedSessions(false);
      setServerGate({
        visible: true,
        checking: true,
        checked: false,
        total: servers.length,
        onlineCount: 0,
        results: servers.map((srv) => ({
          serverId: srv.id,
          name: srv.name || `${srv.host}:${srv.port}`,
          status: 'checking',
          ok: false,
          reason: null,
        })),
      });
    }

    const results = await Promise.allSettled(
      servers.map(async (srv) => {
        if (blockedServerIds.has(srv.id) && !forceServerSet.has(srv.id)) {
          const carried = sessionsRef.current.filter((s) => {
            if (s.server_id) return s.server_id === srv.id;
            return splitSessionId(s.id).serverId === srv.id;
          });
          return { sessions: carried, skippedForRestore: true };
        }
        const data = await getSessions(srv.id);
        const mapped = (data.sessions || [])
          .filter((s) => !s.project_id || s.project_id === projectId)
          .map((s) => ({
            ...s,
            id: composeSessionId(srv.id, s.id),
            server_id: srv.id,
            server_name: srv.name,
            server_color: srv.color,
          }));
        return { sessions: mapped };
      })
    );

    if (runId !== fetchRunIdRef.current) return;

    const merged = [];
    const offline = [];
    const gateResults = [];
    let onlineCount = 0;

    results.forEach((result, index) => {
      const srv = servers[index];
      const name = srv.name || `${srv.host}:${srv.port}`;
      if (result.status === 'fulfilled') {
        if (result.value.skippedForRestore) {
          merged.push(...result.value.sessions);
          if (previousOfflineSet.has(srv.id)) offline.push(srv.id);
          gateResults.push({
            serverId: srv.id,
            name,
            status: previousOfflineSet.has(srv.id) ? 'offline' : 'checking',
            ok: false,
            reason: 'unknown',
          });
          return;
        }
        onlineCount += 1;
        merged.push(...result.value.sessions);
        gateResults.push({
          serverId: srv.id,
          name,
          status: 'online',
          ok: true,
          reason: null,
        });
        // Sucesso silencioso: o background fetch também é o canal canônico
        // de "este server voltou", então propagamos pro health provider —
        // sem toast, só o status muda no header chip.
        markServerOnline(srv.id);
      } else {
        const err = result.reason;
        const reason = err?.reason || 'unreachable';
        offline.push(srv.id);
        gateResults.push({
          serverId: srv.id,
          name,
          status: 'offline',
          ok: false,
          reason,
        });
        // Falha background: nunca mostra toast (offline-por-VPN é estado
        // esperado), só registra no health provider, que agenda backoff
        // pra re-checar o server depois.
        markServerOffline(srv.id, reason);
        console.warn('[fetchSessions] server offline', srv.name, reason, err);
      }
    });

    setSessions(merged);
    setOfflineServerIds(offline);
    setSessionsProjectId(projectId);
    setHydratedSessions(true);

    if (block || (serverGateRef.current.visible && onlineCount > 0)) {
      setServerGate({
        visible: onlineCount === 0,
        checking: false,
        checked: true,
        total: servers.length,
        onlineCount,
        results: gateResults,
      });
    }

    return { onlineCount, total: servers.length, offlineServerIds: offline };
    };

    const run = (async () => {
      let currentOptions = options;
      let result;
      while (true) {
        fetchSessionsQueuedRef.current = null;
        result = await runOnce(currentOptions);
        const queued = fetchSessionsQueuedRef.current;
        if (!queued) return result;
        currentOptions = {
          block: queued.block,
          forceServerIds: [...queued.forceServerIds],
          reason: `coalesced:${queued.reasons.join(',')}`,
        };
      }
    })().finally(() => {
      fetchSessionsInFlightRef.current = null;
    });

    fetchSessionsInFlightRef.current = run;
    return run;
  }, [servers, activeProjectId, markServerOnline, markServerOffline, serversLoaded]);

  const fetchGroups = useCallback(async () => {
    // Grupos são locais (/api/groups), não dependem de servers — então
    // não tem short-circuit por servers=[]. Cold-boot com server offline
    // ainda mostra grupos do projeto ativo.
    const runId = ++fetchGroupsRunIdRef.current;
    const projectId = activeProjectId;
    if (groupsProjectIdRef.current !== projectId) {
      // Troca de projeto: zera grupos antes do await pra UI não exibir
      // grupos do projeto anterior enquanto a nova fetch está em voo.
      // Espelha o tratamento de `!isSameProject` no fetchSessions.
      setGroups([]);
      setHydratedGroups(false);
    }
    try {
      const data = await getGroups();
      if (runId !== fetchGroupsRunIdRef.current) return;
      const list = (data.groups || []).filter((g) => g.project_id === projectId);
      setGroups(list);
    } catch (err) {
      if (runId !== fetchGroupsRunIdRef.current) return;
      showError(err);
    } finally {
      if (runId === fetchGroupsRunIdRef.current) {
        setGroupsProjectId(projectId);
        setHydratedGroups(true);
      }
    }
  }, [showError, activeProjectId]);

  useEffect(() => {
    // Espera serversLoaded (não só !serversLoading): durante /login → /, o
    // ServersProvider tem loading=false e servers=[] do estado anterior, e
    // disparar aqui marcaria sessions/groups como hidratados vazios e zeraria
    // o mosaico. serversLoaded só vira true após o primeiro load() real.
    if (!serversLoaded) return;
    const shouldBlock = lastBlockingLoadKeyRef.current !== blockingLoadKey;
    lastBlockingLoadKeyRef.current = blockingLoadKey;
    fetchSessions({ block: shouldBlock, reason: 'initial-load' });
    fetchGroups();
  }, [serversLoaded, blockingLoadKey, servers, fetchSessions, fetchGroups]);

  const handleBlockingRetry = useCallback(() => {
    if (!serversLoaded) return;
    fetchSessions({ block: true, reason: 'manual-retry' });
    fetchGroups();
  }, [serversLoaded, fetchSessions, fetchGroups]);

  const handleOpenSettingsFromGate = useCallback(() => {
    const url = buildSettingsTargetUrl(serverGate.results);
    setServerGate(EMPTY_SERVER_GATE);
    router.push(url);
  }, [router, serverGate.results]);

  const handleDismissGate = useCallback(() => {
    setServerGate(EMPTY_SERVER_GATE);
  }, []);

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
          const restoreSet = restoreBlockedServerIds;
          for (const srv of servers) {
            if (offlineSet.has(srv.id) || restoreSet.has(srv.id)) continue;
            const existing = Array.isArray(mergedServers[srv.id]) ? mergedServers[srv.id] : [];
            const live = liveByServer[srv.id] || [];
            // Carve-out crítico contra a janela "backend acabou de voltar e
            // ainda não restaurou". `fetchSessions` zera `sessions[]` para
            // o server quando o backend retorna [] (caso típico nos primeiros
            // segundos pós-restart). Sem o carve-out, este efeito escreveria
            // mergedServers[server] = [otherProjects, ...empty], apagando do
            // snapshot todas as entries do projeto ativo — incluindo um
            // terminal recém-criado que ainda nem foi restaurado pelo POST
            // /sessions/restore. handleKill, que é a fonte legítima de
            // "vazio agora", faz seu próprio sync prune via
            // persistSnapshotForServer com sessionsOverride explícito, então
            // pular este caminho não causa snapshot stale após delete.
            const activeProjectExisting = existing.filter((s) => s && s.project_id === activeProjectId);
            if (live.length === 0 && activeProjectExisting.length > 0) continue;
            const otherProjects = existing.filter((s) => s && s.project_id && s.project_id !== activeProjectId);
            mergedServers[srv.id] = [...otherProjects, ...live];
          }

          await setSessionsSnapshot({ servers: mergedServers });
        })
        .catch(err => console.warn('[sessionsSnapshot] persist failed', err));
    }, 500);
  }, [sessions, offlineServerIds, hydratedSessions, servers, activeProjectId, activeProject, sessionsProjectId, restoreBlockedServerIds]);

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
    const restoreSet = restoreBlockedServerIds;
    const knownServerIds = new Set(servers.map(s => s.id));

    let changed = false;
    const next = {};
    for (const [compositeId, draft] of Object.entries(composeDrafts)) {
      const { serverId, sessionId } = splitSessionId(compositeId);
      if (!serverId || !sessionId) { changed = true; continue; }
      if (!knownServerIds.has(serverId)) { changed = true; continue; }
      if (offlineSet.has(serverId) || restoreSet.has(serverId)) {
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
  }, [sessions, offlineServerIds, servers, composeDrafts, hydratedSessions, hydratedComposeDrafts, restoreBlockedServerIds]);

  useEffect(() => {
    return () => {
      if (snapshotDebounceRef.current) clearTimeout(snapshotDebounceRef.current);
      if (restoreRetryTimerRef.current) clearTimeout(restoreRetryTimerRef.current);
    };
  }, []);

  useEffect(() => {
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

      // Per-server gate: each server enters `restoreAttemptedRef` once it has
      // been successfully restored (or confirmed to have nothing to restore).
      // Servers in `serversNeedingRestore` (force-restore after a client
      // restart) bypass the gate and rebuild from snapshot regardless. The
      // old design used a single global boolean — one offline server kept the
      // gate open forever, so any `setSessions` (delete, rename, clone) re-ran
      // the restore against a stale snapshot and could resurrect deleted
      // terminals on healthy servers.
      const restorePromises = [];
      const completedWithoutRequestServerIds = [];
      let skippedBecauseInFlight = false;
      let skippedBecauseBlocked = false;
      const now = Date.now();
      for (const [id, expiresAt] of killedSessionTombstonesRef.current.entries()) {
        if (expiresAt <= now) killedSessionTombstonesRef.current.delete(id);
      }
      for (const [serverId, snapList] of Object.entries(snapshot.servers)) {
        if (!servers.some(srv => srv.id === serverId)) continue;
        if (!Array.isArray(snapList)) continue;
        const forceRestore = serversNeedingRestore.has(serverId);
        const healthStatus = serverHealth[serverId]?.status;
        const healthBlocked =
          healthStatus === SERVER_HEALTH_STATUS.OFFLINE ||
          healthStatus === SERVER_HEALTH_STATUS.CHECKING ||
          healthStatus === SERVER_HEALTH_STATUS.AWAITING_MANUAL_RETRY;
        if (healthBlocked || offlineServerIds.includes(serverId)) {
          skippedBecauseBlocked = true;
          continue;
        }
        if (!forceRestore && restoreAttemptedRef.current.has(serverId)) continue;
        const liveSet = forceRestore ? new Set() : (liveByServer[serverId] || new Set());
        const missing = snapList.filter((s) => {
          if (!s?.id || liveSet.has(s.id)) return false;
          return !killedSessionTombstonesRef.current.has(composeSessionId(serverId, s.id));
        });
        if (missing.length === 0) {
          // Snapshot already aligned with live state — mark attempted so we
          // don't re-evaluate on the next sessions[] change.
          restoreAttemptedRef.current.add(serverId);
          if (forceRestore) completedWithoutRequestServerIds.push(serverId);
          continue;
        }
        if (restoreInFlightRef.current.has(serverId)) {
          skippedBecauseInFlight = true;
          continue;
        }
        restoreInFlightRef.current.add(serverId);
        restorePromises.push(
          restoreSessions(serverId, missing)
            .then(res => ({ serverId, res, forceRestore, requested: missing.length }))
            .catch(err => ({ serverId, err, forceRestore, requested: missing.length }))
            .finally(() => { restoreInFlightRef.current.delete(serverId); })
        );
      }
      if (completedWithoutRequestServerIds.length > 0) {
        clearRestoreBarrierForServers(completedWithoutRequestServerIds);
      }
      if (restorePromises.length === 0) {
        if (skippedBecauseInFlight || skippedBecauseBlocked) return;
        // Either every server in snapshot has no missing sessions, or the
        // snapshot is empty for known servers. Mark all known servers as
        // attempted so subsequent sessions[] mutations don't re-run this.
        for (const srv of servers) restoreAttemptedRef.current.add(srv.id);
        return;
      }

      const results = await Promise.all(restorePromises);
      const totalRestored = results.reduce(
        (sum, r) => sum + (r.res?.restored?.length || 0), 0
      );
      const succeededServerIds = [];
      let anyFailed = false;
      for (const r of results) {
        if (r.err) { anyFailed = true; continue; }
        // Tudo skipped (backend já tem essas sessões) é tratado como sucesso,
        // não como retry. Cenário comum: outro dashboard (multi-PC) ou nosso
        // próprio retry anterior já restaurou as PTYs antes desta resposta
        // chegar — backend responde 200 com `skipped >= requested`. A versão
        // anterior agendava scheduleRestoreRetry quando isso acontecia, criando
        // um loop infinito de POST /sessions/restore a cada 3s. Cada iteração
        // do loop disparava setSessions → snapshot persist → PUT /api/sessions
        // no GCS, que tem rate limit por chave (~1/s); resultado: cascata de
        // HTTP 429 SlowDown e dashboards travados. O cleanup abaixo
        // (fetchSessions + remove do restoreSet) encerra o ciclo corretamente.
        restoreAttemptedRef.current.add(r.serverId);
        succeededServerIds.push(r.serverId);
      }
      if (succeededServerIds.length > 0) {
        await fetchSessions({ forceServerIds: succeededServerIds, reason: 'restore-success' });
        for (const serverId of succeededServerIds) {
          destroyTerminalsByServerId(serverId);
        }
        clearRestoreBarrierForServers(succeededServerIds);
        setServerReconnectKeys(prev => {
          const next = { ...prev };
          for (const serverId of succeededServerIds) {
            next[serverId] = (next[serverId] || 0) + 1;
          }
          return next;
        });
      }
      if (anyFailed) {
        // Apenas falhas reais (network error / server unreachable) agendam
        // retry. Servers que tiveram sucesso ou skipped são marcados como
        // attempted acima e não voltam a este caminho.
        scheduleRestoreRetry();
      }
      if (totalRestored > 0) {
        toast.success(t('toast.sessions_auto_restored', { count: totalRestored }));
      }
    })();
  }, [servers, serversLoading, hydratedSessions, sessions, offlineServerIds, serverHealth, fetchSessions, t, serversNeedingRestore, restoreRetryKey, scheduleRestoreRetry, clearRestoreBarrierForServers]);

  useEffect(() => {
    if (!hydrated) return;
    if (!projectDataReady) return;
    if (!sessionsForDisplay.length) return;
    const sid = searchParams.get('session');
    if (!sid) { handledSessionRef.current = null; return; }
    if (handledSessionRef.current === sid) return;

    const session = sessionsForDisplay.find(s => s.id === sid);
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
  }, [searchParams, sessionsForDisplay, hydrated, projectDataReady, isMobile, mosaicLayout, isMaximized, router]);

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
    const scopeProjectId = activeProjectIdRef.current;
    try {
      const data = await renameSession(id, newName);
      if (activeProjectIdRef.current !== scopeProjectId) return;
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
    const scopeProjectId = activeProjectIdRef.current;
    try {
      const group = groupId ? groups.find(g => g.id === groupId) : null;
      const data = await createSession(serverId, name, groupId, cwd, {
        groupName: group?.name || t('sidebar.noGroup'),
        projectName: activeProject?.name || t('projects.defaultName'),
      });
      if (activeProjectIdRef.current !== scopeProjectId) return;
      const session = decorateSession(data.session, serverId);
      const nextSessions = [...sessionsRef.current.filter(s => s.id !== session.id), session];
      sessionsRef.current = nextSessions;
      setSessions(nextSessions);
      if (snapshotDebounceRef.current) {
        clearTimeout(snapshotDebounceRef.current);
        snapshotDebounceRef.current = null;
      }
      snapshotInFlight.current = snapshotInFlight.current
        .catch(() => {})
        .then(() => persistSnapshotForServer(serverId, nextSessions))
        .catch(err => console.warn('[handleCreate] snapshot persist failed', err));
      // A successful mutation proves the server is online — if it had been
      // marked offline by an earlier race-y fetch, the snapshot effect would
      // otherwise skip this server and sessions.json would never record the
      // new session (it skips every srv in offlineServerIds).
      setOfflineServerIds(prev => prev.filter(id => id !== serverId));
      markServerOnline(serverId);
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
      if (err?.serverId && (err.reason === 'unreachable' || err.reason === 'timeout')) {
        markServerOffline(err.serverId, err.reason);
      }
      showError(err);
    }
  }

  async function handleKill(id) {
    const scopeProjectId = activeProjectIdRef.current;
    try {
      await killSession(id);
      if (activeProjectIdRef.current !== scopeProjectId) return;
      const { serverId } = splitSessionId(id);
      killedSessionTombstonesRef.current.set(id, Date.now() + 30000);
      // Calcula a lista pós-delete agora — `setSessions` é assíncrono e a
      // closure de `sessions` capturada por `persistSnapshotForServer` ainda
      // contém o id deletado. Passamos a lista filtrada explicitamente para
      // o helper como override, garantindo que o snapshot escrito não tenha
      // a sessão.
      const remainingSessions = sessionsRef.current.filter(s => s.id !== id);
      sessionsRef.current = remainingSessions;
      destroyTerminal(id);
      setSessions(remainingSessions);
      setMosaicLayout(prev => prev ? removeFromTree(prev, id) : prev);
      // Sync prune: remove a sessão deletada do snapshot agora, sem esperar
      // o debounce de 500ms. Cobre o caso em que outro server está offline
      // e o efeito de restore re-dispara antes do debounce, lendo snapshot
      // stale e ressuscitando a sessão recém-deletada via /sessions/restore.
      if (serverId) {
        if (snapshotDebounceRef.current) {
          clearTimeout(snapshotDebounceRef.current);
          snapshotDebounceRef.current = null;
        }
        snapshotInFlight.current = snapshotInFlight.current
          .catch(() => {})
          .then(() => persistSnapshotForServer(serverId, remainingSessions))
          .catch(err => console.warn('[handleKill] snapshot prune failed', err));
      }
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
    const scopeProjectId = activeProjectIdRef.current;
    setBusySessionIds(prev => new Set(prev).add(sourceSessionId));
    try {
      const data = await cloneSession(sourceSessionId);
      if (activeProjectIdRef.current !== scopeProjectId) return;
      const session = decorateSession(data.session, serverId);
      const nextSessions = [...sessionsRef.current.filter(s => s.id !== session.id), session];
      sessionsRef.current = nextSessions;
      setSessions(nextSessions);
      if (snapshotDebounceRef.current) {
        clearTimeout(snapshotDebounceRef.current);
        snapshotDebounceRef.current = null;
      }
      snapshotInFlight.current = snapshotInFlight.current
        .catch(() => {})
        .then(() => persistSnapshotForServer(serverId, nextSessions))
        .catch(err => console.warn('[handleSplit] snapshot persist failed', err));
      // Successful clone = server is online (see handleCreate for rationale).
      setOfflineServerIds(prev => prev.filter(id => id !== serverId));
      markServerOnline(serverId);
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
      if (err?.serverId && (err.reason === 'unreachable' || err.reason === 'timeout')) {
        markServerOffline(err.serverId, err.reason);
      }
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

  const bumpServerReconnectKey = useCallback((serverId) => {
    if (!serverId) return;
    setServerReconnectKeys(prev => ({
      ...prev,
      [serverId]: (prev[serverId] || 0) + 1,
    }));
  }, []);

  // Reconexão global explícita (botão "Wifi" na sidebar, listener de
  // visibilitychange/pageshow). Destroi e remonta todos os panes — preço
  // alto, mas é o que o usuário pediu.
  const handleReconnectAll = useCallback((options = {}) => {
    destroyAllTerminals();
    setReconnectKey(prev => prev + 1);
    if (!options.silent) toast.success(t('toast.reconnecting'));
  }, [t]);

  // Reconexão escopada por server: destrói os panes desse server e força
  // remount via key sufixada com serverReconnectKeys[serverId]. Não toca
  // panes de outros servers — usuário com múltiplos servers e VPNs não
  // perde estado em servidores que estão funcionando.
  const handleReconnectServer = useCallback((serverId, options = {}) => {
    if (!serverId) return;
    const now = Date.now();
    const last = serverReconnectCooldownRef.current.get(serverId) || 0;
    if (now - last < 1500) return;
    serverReconnectCooldownRef.current.set(serverId, now);
    destroyTerminalsByServerId(serverId);
    bumpServerReconnectKey(serverId);
    if (!options.silent) toast.success(t('toast.reconnecting'));
  }, [bumpServerReconnectKey, t]);

  // Adapter para a API antiga `onReconnect(sessionId?, options?)` usada por
  // TerminalPane/Sidebar. Roteia entre handleReconnectAll/Server conforme
  // o motivo: WS automatic failures (client_restart, heartbeat_timeout)
  // sempre são server-scoped silenciosos; clique no Wifi (sessionId=null,
  // sem reason) cai no global toast.
  function handleReconnect(sessionId = null, options = {}) {
    if (options.reason === 'client_restart') {
      const { serverId } = splitSessionId(sessionId);
      if (serverId) {
        // markServerForRestore agora é async (faz flush sync do snapshot
        // antes de liberar o restore). Disparado fire-and-forget; enquanto
        // prepara/restaura, o pane fica bloqueado e não abre WS para uma
        // sessão que ainda existe só no snapshot.
        markServerForRestore(serverId).catch(() => {});
      } else {
        handleReconnectAll({ silent: true });
      }
      return;
    }
    if (options.reason === 'heartbeat_timeout' && sessionId) {
      const { serverId } = splitSessionId(sessionId);
      if (serverId) {
        handleReconnectServer(serverId, { silent: true });
        Promise.resolve(fetchSessions({ reason: 'heartbeat-timeout' })).catch((err) => {
          console.warn('[heartbeat_timeout] session refetch failed', err);
        });
        return;
      }
    }
    handleReconnectAll(options);
  }

  const handleReconnectServerRef = useRef(handleReconnectServer);
  handleReconnectServerRef.current = handleReconnectServer;

  // Versão "manual" do retry exposta no chip do header e no placeholder
  // offline. Diferente do auto-recovery, o caso manual aceita toasts:
  // sucesso → toast.serverReconnected, falha → erro mapeado pra i18n.
  const handleManualRetry = useCallback(async (serverId) => {
    const server = servers.find(s => s.id === serverId);
    const name = server?.name || (server ? `${server.host}:${server.port}` : serverId);
    try {
      const result = await retryServer(serverId);
      if (!result) return;
      if (result.ok) {
        toast.success(t('toast.serverReconnected', { name }));
      } else {
        const reasonKey = `serverFilter.reason.${result.reason || 'unknown'}`;
        const err = new Error(`${name}: ${t(reasonKey)}`);
        err.detail_key = reasonKey;
        err.detail_params = { name };
        showError(err);
      }
    } catch (err) {
      showError(err);
    }
  }, [retryServer, servers, t, showError]);

  // Auto-recovery: quando o health flipa offline → online (via backoff
  // automático ou via mutação bem-sucedida), reconectamos os panes desse
  // server especificamente — silenciosamente, sem toast — e refazemos o
  // fetchSessions pra pegar sessões que possam ter sido recriadas no
  // backend enquanto o server estava inacessível.
  const previousHealthRef = useRef({});
  // Guarda contra rajada: fetchSessions internamente chama markServerOnline
  // que muda serverHealth e re-dispara este effect. Sem o gate, um server
  // que flapeia online↔offline durante a fetch pode encadear N fetchSessions
  // overlapping. O ref deixa só uma fetch em voo por vez — se outra recovery
  // acontecer enquanto a primeira ainda está rodando, o próximo fetch é
  // implícito (a transição de status que ela vai produzir já dispara este
  // mesmo effect de novo).
  const recoveryFetchInFlightRef = useRef(false);
  useEffect(() => {
    const prev = previousHealthRef.current;
    let recoveredAny = false;
    for (const [serverId, entry] of Object.entries(serverHealth)) {
      const wasOffline =
        prev[serverId]?.status === SERVER_HEALTH_STATUS.OFFLINE ||
        prev[serverId]?.status === SERVER_HEALTH_STATUS.AWAITING_MANUAL_RETRY;
      const isOnline = entry?.status === SERVER_HEALTH_STATUS.ONLINE;
      if (wasOffline && isOnline) {
        if (restoreBlockedServerIdsRef.current.has(serverId)) continue;
        handleReconnectServer(serverId, { silent: true });
        recoveredAny = true;
      }
    }
    previousHealthRef.current = serverHealth;
    if (recoveredAny && !recoveryFetchInFlightRef.current) {
      recoveryFetchInFlightRef.current = true;
      const shouldBlock = serverGateRef.current.visible
        && serverGateRef.current.checked
        && serverGateRef.current.onlineCount === 0;
      Promise.resolve(fetchSessions({ block: shouldBlock, reason: 'health-recovery' }))
        .finally(() => { recoveryFetchInFlightRef.current = false; });
    }
  }, [serverHealth, handleReconnectServer, fetchSessions]);

  useEffect(() => {
    const BACKOFF = [2000, 5000, 15000, 30000, 60000];
    let scheduled = false;
    let attempt = 0;
    const reconnectServers = (serverIds) => {
      const unique = [...new Set((serverIds || []).filter(Boolean))];
      if (unique.length === 0) return false;
      for (const serverId of unique) {
        handleReconnectServerRef.current?.(serverId, { silent: true });
      }
      return true;
    };
    const trigger = () => {
      if (scheduled) return;
      const serverIds = getDeadConnectionServerIds();
      if (serverIds.length === 0) { attempt = 0; return; }
      scheduled = true;
      const delay = BACKOFF[Math.min(attempt, BACKOFF.length - 1)];
      setTimeout(() => { scheduled = false; }, delay);
      attempt += 1;
      if (reconnectServers(serverIds)) {
        Promise.resolve(fetchSessions({ reason: 'dead-connection' })).catch((err) => {
          console.warn('[dead_connections] session refetch failed', err);
        });
      }
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
        probeDeadConnectionServerIds(2000).then((serverIds) => {
          if (reconnectServers(serverIds)) {
            Promise.resolve(fetchSessions({ reason: 'zombie-connection' })).catch((err) => {
              console.warn('[zombie_connections] session refetch failed', err);
            });
          }
        });
      }
    };
    const onPageShow = (e) => {
      if (e.persisted) { attempt = 0; trigger(); }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('online', onVisibilityChange);
    window.addEventListener('offline', trigger);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('online', onVisibilityChange);
      window.removeEventListener('offline', trigger);
    };
  }, [fetchSessions]);

  function handleCloseTile(sessionId) {
    setMosaicLayout(prev => prev ? removeFromTree(prev, sessionId) : prev);
  }

  function handleMobileClose(sessionId) {
    handleCloseTile(sessionId);
  }

  async function handleToggleNotify(sessionId, value) {
    const scopeProjectId = activeProjectIdRef.current;
    const prev = sessions;
    setSessions(p => p.map(s => s.id === sessionId ? { ...s, notify_on_idle: value } : s));
    try {
      await setSessionNotify(sessionId, value);
    } catch (err) {
      if (activeProjectIdRef.current !== scopeProjectId) return;
      setSessions(prev);
      showError(err);
    }
  }

  async function handleAssignGroup(sessionId, groupId) {
    const scopeProjectId = activeProjectIdRef.current;
    const prevSessions = sessions;
    const group = groupId ? groups.find(g => g.id === groupId) : null;
    // Sempre grava um label legível (mesmo "Sem grupo") pra notificação ficar
    // consistente "{projeto} › {grupo} › {terminal}", sem omitir partes.
    const groupName = group?.name || t('sidebar.noGroup');
    setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, group_id: groupId, group_name: groupName } : s));
    try {
      await assignSessionGroup(sessionId, groupId, groupName);
    } catch (err) {
      if (activeProjectIdRef.current !== scopeProjectId) return;
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

  async function handleVoiceTranscript(text) {
    const sid = voiceTargetId;
    if (!sid) { setVoiceTargetId(null); return; }
    if (!isTerminalConnected(sid)) {
      toast.error(t('terminal.actions.disconnected'));
      setVoiceTargetId(null);
      return;
    }
    try {
      await sendTextToSession(sid, text || '', false);
    } catch (err) {
      showError(err);
      return;
    }
    setVoiceTargetId(null);
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
    const scopeProjectId = activeProjectIdRef.current;
    const next = reorderById(groups, fromId, toId);
    if (next === groups) return;
    const prev = groups;
    setGroups(next);
    try {
      await saveGroups(next);
    } catch (err) {
      if (activeProjectIdRef.current !== scopeProjectId) return;
      setGroups(prev);
      showError(err);
    }
  }

  async function handleHideGroup(groupId) {
    const scopeProjectId = activeProjectIdRef.current;
    const prevGroups = groups;
    setGroups(prev => prev.map(g => g.id === groupId ? { ...g, hidden: true } : g));
    try {
      await setGroupHidden(groupId, true);
      if (activeProjectIdRef.current !== scopeProjectId) return;
      toast.success(t('groupSelector.hidden'));
    } catch (err) {
      if (activeProjectIdRef.current !== scopeProjectId) return;
      setGroups(prevGroups);
      showError(err);
    }
  }

  async function handleCreateGroupInline(name) {
    const scopeProjectId = activeProjectIdRef.current;
    try {
      const data = await createGroup(name);
      if (activeProjectIdRef.current !== scopeProjectId) return null;
      setGroups(prev => [...prev, data.group]);
      return data.group;
    } catch (err) {
      showError(err);
      throw err;
    }
  }

  return (
    <div className="relative flex flex-col h-full min-h-0">
      <div className={`flex flex-1 min-h-0 overflow-hidden relative ${isMobile ? 'pl-12' : ''}`}>

        {isMobile && sidebarOpen && (
          <div
            className="sidebar-backdrop absolute inset-0 z-30 bg-overlay/60"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <Sidebar
          sessions={sessionsVisibleInWorkspace}
          allSessions={sessionsForDisplay}
          groups={groupsForDisplay}
          servers={servers}
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
          serverHealth={serverHealth}
        />

        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          <WorkspaceContextBar
            groups={groupsForDisplay}
            sessions={sessionsForDisplay}
            groupSessions={sessionsInSelectedGroup}
            selectedGroupId={selectedGroupId}
            onSelectGroup={setSelectedGroupId}
            onHideGroup={handleHideGroup}
            onReorderGroups={handleReorderGroups}
            onGroupsChanged={fetchGroups}
            servers={servers}
            selectedServerFilterId={selectedServerFilterId}
            onSelectServerFilter={setSelectedServerFilterId}
            serverHealth={serverHealth}
            onRetryServer={handleManualRetry}
            isMobile={isMobile}
          />
          <TerminalMosaic
          key={reconnectKey}
          sessions={sessionsVisibleInWorkspace}
          layout={mosaicRenderLayout}
          onLayoutChange={selectedServerFilterId ? () => {} : setMosaicLayout}
          onSplitH={handleSplitH}
          onSplitV={handleSplitV}
          onClose={handleCloseTile}
          onMaximize={selectedServerFilterId ? () => {} : handleMaximize}
          isMaximized={!selectedServerFilterId && isMaximized}
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
          serverReconnectKeys={serverReconnectKeys}
          restoringServerIds={restoreBlockedServerIds}
          serverHealth={serverHealth}
          onRetryServer={handleManualRetry}
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
          onTranscript={handleVoiceTranscript}
          onClose={() => setVoiceTargetId(null)}
        />
      )}

      <TlsAcceptModal
        servers={servers}
        offlineServerIds={offlineServerIds}
        onRetest={() => fetchSessions({ reason: 'tls-retest' })}
      />

      <ServerBootGateModal
        gate={serverGate}
        t={t}
        onRetry={handleBlockingRetry}
        onOpenSettings={handleOpenSettingsFromGate}
        onDismiss={handleDismissGate}
      />
    </div>
  );
}
