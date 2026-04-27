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
  // Servers cuja resposta de getSessions ainda está pendente na fetch atual.
  // Usado pra gatear efeitos destrutivos (validateTree, snapshot persist,
  // compose drafts cleanup) enquanto a foto está parcial — sem isso, um
  // servidor lento (ex.: VPN offline) faria os outros perderem layout/snapshot
  // até o timeout de 3s.
  const [pendingSessionServerIds, setPendingSessionServerIds] = useState([]);
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
  const restoreRetryTimerRef = useRef(null);
  // Epoch counter pra descartar respostas obsoletas: se o usuário troca de
  // projeto/server enquanto uma fetch está em curso, comparamos runId no
  // handler de cada server e ignoramos updates de fetches superadas.
  const fetchRunIdRef = useRef(0);
  // Epoch independente pra fetchGroups: grupos vêm do dashboard local
  // (/api/groups), não dos servers, então rodam mesmo com servers=[]. O
  // contador descarta respostas atrasadas de troca de projeto.
  const fetchGroupsRunIdRef = useRef(0);
  // Espelho de sessionsProjectId pra detectar troca de projeto sem precisar
  // adicionar sessionsProjectId às deps de fetchSessions (evita loop de
  // useCallback, já que setSessionsProjectId é chamado dentro dele).
  const sessionsProjectIdRef = useRef(null);
  // Espelho de groupsProjectId, mesma motivação do sessionsProjectIdRef.
  const groupsProjectIdRef = useRef(null);
  // Espelho de activeProjectId pra handlers async checarem se o usuário
  // trocou de projeto enquanto a request estava em voo.
  const activeProjectIdRef = useRef(null);
  // Fallback visual: serverId -> [rawSessions] do snapshot persistido.
  // Usado só pra render quando o server real está offline e a fetch live
  // não trouxe sessões. Nunca é gravado de volta.
  const [snapshotByServer, setSnapshotByServer] = useState({});
  const [busySessionIds, setBusySessionIds] = useState(new Set());
  const [draggingId, setDraggingId] = useState(null);
  const [reconnectKey, setReconnectKey] = useState(0);
  // serverId -> contador incremental. Usado como sufixo na key do TerminalPane
  // pra forçar remount somente dos panes do server que precisa reconectar
  // (em vez de remontar todo o TerminalMosaic via reconnectKey global).
  const [serverReconnectKeys, setServerReconnectKeys] = useState({});
  const [restoreRetryKey, setRestoreRetryKey] = useState(0);
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

  const markServerForRestore = useCallback((serverId) => {
    if (!serverId) return;
    restoreAttemptedRef.current = false;
    setServersNeedingRestore(prev => {
      if (prev.has(serverId)) return prev;
      const next = new Set(prev);
      next.add(serverId);
      return next;
    });
    setOfflineServerIds(prev => prev.includes(serverId) ? prev : [...prev, serverId]);
    setRestoreRetryKey(k => k + 1);
  }, []);

  // Mantém sessionsProjectIdRef sincronizado pra fetchSessions detectar troca
  // de projeto sem adicionar sessionsProjectId às próprias deps.
  useEffect(() => { sessionsProjectIdRef.current = sessionsProjectId; }, [sessionsProjectId]);
  useEffect(() => { groupsProjectIdRef.current = groupsProjectId; }, [groupsProjectId]);
  useEffect(() => { activeProjectIdRef.current = activeProjectId; }, [activeProjectId]);

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
  const liveSessionsForDisplay = sessionsProjectId === activeProjectId ? sessions : EMPTY_ARRAY;

  useEffect(() => {
    if (!projectDataReady) return;
    if (selectedGroupId === null) return;
    const match = groupsForDisplay.find(g => g.id === selectedGroupId);
    if (!match || match.hidden) {
      setSelectedGroupId(null);
    }
  }, [groupsForDisplay, selectedGroupId, projectDataReady, setSelectedGroupId]);

  // Carrega o snapshot persistido quando o dashboard hidrata ou quando muda
  // a lista de servers offline. É só leitura: o snapshot é mantido por um
  // effect separado (linhas ~509-559). Falha silenciosa: se a leitura
  // falhar, o fallback simplesmente não aparece.
  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getSessionsSnapshot();
        if (cancelled) return;
        const byServer = snap?.servers && typeof snap.servers === 'object' ? snap.servers : {};
        setSnapshotByServer(byServer);
      } catch (err) {
        console.warn('[snapshotByServer] load failed', err);
      }
    })();
    return () => { cancelled = true; };
  }, [hydrated, offlineServerIds]);

  // sessionsForDisplay: mistura sessions live com fallback visual do snapshot.
  // Para cada server offline sem sessões live, anexa entradas do snapshot
  // marcadas com snapshot_only=true. Usado SÓ em leituras de UI (Sidebar,
  // mosaic, validate). `sessions` segue sendo a fonte canônica pra
  // persistência, restore, drafts e mutações.
  const sessionsForDisplay = useMemo(() => {
    if (sessionsProjectId !== activeProjectId) return EMPTY_ARRAY;
    if (offlineServerIds.length === 0) return liveSessionsForDisplay;
    const liveServerIds = new Set();
    for (const s of liveSessionsForDisplay) liveServerIds.add(s.server_id);
    const result = liveSessionsForDisplay.slice();
    for (const serverId of offlineServerIds) {
      if (liveServerIds.has(serverId)) continue;
      // bad_key (HTTP 401) é problema de credencial, não de conectividade.
      // Mostrar stubs paused enganaria o usuário sugerindo "VPN caiu" quando
      // na verdade a apiKey está errada — o chip do header já comunica isso
      // via serverFilter.reason.bad_key.
      if (serverHealth[serverId]?.reason === 'bad_key') continue;
      const srv = servers.find(s => s.id === serverId);
      if (!srv) continue;
      const snapList = snapshotByServer[serverId];
      if (!Array.isArray(snapList)) continue;
      for (const raw of snapList) {
        if (!raw || !raw.id) continue;
        if (raw.project_id && raw.project_id !== activeProjectId) continue;
        result.push({
          ...raw,
          id: composeSessionId(serverId, raw.id),
          server_id: serverId,
          server_name: srv.name,
          server_color: srv.color,
          snapshot_only: true,
        });
      }
    }
    return result;
  }, [liveSessionsForDisplay, sessionsProjectId, activeProjectId, offlineServerIds, snapshotByServer, servers, serverHealth]);

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
      || pendingSessionServerIds.length > 0
      || serversNeedingRestore.size > 0;
    if (!shouldValidateRenderLayout) return mosaicLayout;
    const validIds = new Set(sessionsVisibleInWorkspace.map(s => s.id));
    return validateTree(mosaicLayout, validIds);
  }, [mosaicLayout, selectedServerFilterId, sessionsVisibleInWorkspace, offlineServerIds, pendingSessionServerIds, serversNeedingRestore]);

  const mobileOpenIds = useMemo(() => Array.from(getVisibleSessionIds(mosaicRenderLayout)), [mosaicRenderLayout]);

  useEffect(() => {
    if (!projectDataReady) return;
    // pendingSessionServerIds entra no gate junto com offline/restore: durante
    // o carregamento progressivo, a foto de sessions é parcial; rodar
    // validateTree aqui zeraria tiles dos servers que ainda não responderam.
    if (offlineServerIds.length > 0 || serversNeedingRestore.size > 0 || pendingSessionServerIds.length > 0) return;
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
  }, [sessions, groups, projectDataReady, activeProjectId, offlineServerIds, serversNeedingRestore, pendingSessionServerIds]);

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
      setPendingSessionServerIds([]);
      setSessionsProjectId(activeProjectId);
      // Com serversLoaded já true (gate no useEffect que dispara este callback),
      // servers=[] significa "dashboard configurado sem nenhum server" e não a
      // janela /login → / antes do ServersProvider carregar. Marcar hidratado
      // vazio aqui é seguro e necessário pra projectDataReady abrir.
      if (serversLoaded) setHydratedSessions(true);
      return;
    }

    const runId = ++fetchRunIdRef.current;
    const previousProjectId = sessionsProjectIdRef.current;
    const isSameProject = previousProjectId === activeProjectId;
    const validServerIds = new Set(servers.map(s => s.id));

    // Abre o gate do projectDataReady cedo (sessionsProjectId match + a
    // marcação de hydratedSessions abaixo) pra que a UI consiga renderizar
    // os terminais de cada server assim que ele responder, em vez de esperar
    // o servidor mais lento. pendingSessionServerIds protege os efeitos
    // destrutivos enquanto a foto está parcial.
    setSessionsProjectId(activeProjectId);
    setPendingSessionServerIds(servers.map(s => s.id));

    if (isSameProject) {
      // Refetch do mesmo projeto: preserva sessions já mostradas e só remove
      // servers que sumiram. Cada server vai sobrescrever sua fatia conforme
      // responder.
      setSessions(prev => prev.filter(s => validServerIds.has(s.server_id)));
      setOfflineServerIds(prev => prev.filter(id => validServerIds.has(id)));
    } else {
      // Troca de projeto: zera tudo. Sem isso, sessions do projeto anterior
      // vazariam visualmente até o último server responder.
      setSessions([]);
      setOfflineServerIds([]);
    }

    const promises = servers.map(async (srv) => {
      try {
        const data = await getSessions(srv.id);
        if (runId !== fetchRunIdRef.current) return;
        const mapped = (data.sessions || [])
          .filter((s) => !s.project_id || s.project_id === activeProjectId)
          .map(s => ({
            ...s,
            id: composeSessionId(srv.id, s.id),
            server_id: srv.id,
            server_name: srv.name,
            server_color: srv.color,
          }));
        // Replace-by-server: substitui só a fatia deste server, preservando
        // sessions de outros servers já carregados.
        setSessions(prev => [
          ...prev.filter(s => s.server_id !== srv.id),
          ...mapped,
        ]);
        setOfflineServerIds(prev => prev.includes(srv.id) ? prev.filter(id => id !== srv.id) : prev);
        // Sucesso silencioso: o background fetch também é o canal canônico
        // de "este server voltou", então propagamos pro health provider —
        // sem toast, só o status muda no header chip.
        markServerOnline(srv.id);
      } catch (err) {
        if (runId !== fetchRunIdRef.current) return;
        const reason = err?.reason || 'unreachable';
        setOfflineServerIds(prev => prev.includes(srv.id) ? prev : [...prev, srv.id]);
        // Falha background: nunca mostra toast (offline-por-VPN é estado
        // esperado), só registra no health provider, que agenda backoff
        // pra re-checar o server depois.
        markServerOffline(srv.id, reason);
        console.warn('[fetchSessions] server offline', srv.name, reason, err);
      } finally {
        if (runId === fetchRunIdRef.current) {
          setPendingSessionServerIds(prev => prev.includes(srv.id) ? prev.filter(id => id !== srv.id) : prev);
        }
      }
    });

    // Marca hidratado já durante o fetch: projectDataReady vira true assim
    // que hydratedLayouts/Groups também estiverem prontos, e o mosaic começa
    // a renderizar incrementalmente. Os efeitos destrutivos são gatedos pelo
    // pendingSessionServerIds, então não há limpeza na foto parcial.
    setHydratedSessions(true);

    await Promise.all(promises);
    if (runId !== fetchRunIdRef.current) return;
    // Salva-vidas: cada finally já limpa seu próprio slot, então no fluxo
    // normal pending já está vazio aqui — esse setState é só pra garantir
    // que nenhum bug futuro deixe um servidor preso pendente para sempre.
    setPendingSessionServerIds(prev => prev.length === 0 ? prev : []);
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
    fetchSessions();
    fetchGroups();
  }, [serversLoaded, servers, fetchSessions, fetchGroups]);

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
          const restoreSet = serversNeedingRestore;
          const pendingSet = new Set(pendingSessionServerIds);
          for (const srv of servers) {
            // Servers offline, em restore ou ainda pendentes na fetch atual
            // mantêm o snapshot anterior intacto: sem isso, um server lento
            // teria suas sessões zeradas no snapshot enquanto a foto está
            // parcial, e um F5 perderia os dados.
            if (offlineSet.has(srv.id) || restoreSet.has(srv.id) || pendingSet.has(srv.id)) continue;
            const existing = Array.isArray(mergedServers[srv.id]) ? mergedServers[srv.id] : [];
            const otherProjects = existing.filter((s) => s && s.project_id && s.project_id !== activeProjectId);
            mergedServers[srv.id] = [...otherProjects, ...(liveByServer[srv.id] || [])];
          }

          await setSessionsSnapshot({ servers: mergedServers });
        })
        .catch(err => console.warn('[sessionsSnapshot] persist failed', err));
    }, 500);
  }, [sessions, offlineServerIds, hydratedSessions, servers, activeProjectId, activeProject, sessionsProjectId, serversNeedingRestore, pendingSessionServerIds]);

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
    const restoreSet = serversNeedingRestore;
    const pendingSet = new Set(pendingSessionServerIds);
    const knownServerIds = new Set(servers.map(s => s.id));

    let changed = false;
    const next = {};
    for (const [compositeId, draft] of Object.entries(composeDrafts)) {
      const { serverId, sessionId } = splitSessionId(compositeId);
      if (!serverId || !sessionId) { changed = true; continue; }
      if (!knownServerIds.has(serverId)) { changed = true; continue; }
      // Server offline/restore/pending → preserva o draft. Sem o pending, um
      // server ainda carregando teria seu draft considerado "órfão" e
      // descartado antes de a sessão correspondente reaparecer.
      if (offlineSet.has(serverId) || restoreSet.has(serverId) || pendingSet.has(serverId)) {
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
  }, [sessions, offlineServerIds, servers, composeDrafts, hydratedSessions, hydratedComposeDrafts, serversNeedingRestore, pendingSessionServerIds]);

  useEffect(() => {
    return () => {
      if (snapshotDebounceRef.current) clearTimeout(snapshotDebounceRef.current);
      if (restoreRetryTimerRef.current) clearTimeout(restoreRetryTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (restoreAttemptedRef.current) return;
    if (serversLoading) return;
    if (!servers || servers.length === 0) return;
    if (!hydratedSessions) return;
    // Espera todos os servers responderem (ou caírem em offline) antes de
    // tentar restore: hydratedSessions agora vira true cedo durante a fetch
    // progressiva, mas a lista `sessions` está parcial enquanto há
    // pendingSessionServerIds — disparar restore aqui faria roundtrip
    // desnecessário (o client já tem essas sessões vivas) e poderia rodar
    // skippedDuringForcedRestore por engano. Esse early-return não bloqueia
    // permanentemente: o effect re-dispara a cada update de
    // pendingSessionServerIds (está nas deps abaixo) e cruza o gate quando
    // o último server sai de pending.
    if (pendingSessionServerIds.length > 0) return;

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
        if (!Array.isArray(snapList)) continue;
        const forceRestore = serversNeedingRestore.has(serverId);
        const liveSet = forceRestore ? new Set() : (liveByServer[serverId] || new Set());
        const missing = snapList.filter(s => !liveSet.has(s.id));
        if (missing.length === 0) continue;
        restorePromises.push(
          restoreSessions(serverId, missing)
            .then(res => ({ serverId, res, forceRestore, requested: missing.length }))
            .catch(err => ({ serverId, err, forceRestore, requested: missing.length }))
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
      const skippedDuringForcedRestore = results.some((r) => {
        if (r.err || !r.forceRestore) return false;
        const restored = r.res?.restored?.length || 0;
        const skipped = r.res?.skipped?.length || 0;
        return restored === 0 && skipped > 0 && skipped >= r.requested;
      });
      if (!anyFailed && !skippedDuringForcedRestore) {
        restoreAttemptedRef.current = true;
        await fetchSessions();
        const succeededServerIds = results.map(r => r.serverId);
        for (const serverId of succeededServerIds) {
          destroyTerminalsByServerId(serverId);
        }
        setReconnectKey(prev => prev + 1);
        setServersNeedingRestore(prev => {
          let changed = false;
          const next = new Set(prev);
          for (const serverId of succeededServerIds) {
            if (next.delete(serverId)) changed = true;
          }
          return changed ? next : prev;
        });
      } else {
        scheduleRestoreRetry();
      }
      if (totalRestored > 0) {
        toast.success(t('toast.sessions_auto_restored', { count: totalRestored }));
      }
    })();
  }, [servers, serversLoading, hydratedSessions, sessions, offlineServerIds, fetchSessions, t, serversNeedingRestore, restoreRetryKey, scheduleRestoreRetry, pendingSessionServerIds]);

  useEffect(() => {
    if (!hydrated) return;
    if (!projectDataReady) return;
    if (!sessionsForDisplay.length) return;
    const sid = searchParams.get('session');
    if (!sid) { handledSessionRef.current = null; return; }
    if (handledSessionRef.current === sid) return;

    const session = sessionsForDisplay.find(s => s.id === sid);
    if (!session) {
      const { serverId } = splitSessionId(sid);
      if (serverId && pendingSessionServerIds.includes(serverId)) return;
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
  }, [searchParams, sessionsForDisplay, hydrated, projectDataReady, isMobile, mosaicLayout, isMaximized, router, pendingSessionServerIds]);

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
      setSessions(prev => [...prev, session]);
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
    const scopeProjectId = activeProjectIdRef.current;
    setBusySessionIds(prev => new Set(prev).add(sourceSessionId));
    try {
      const data = await cloneSession(sourceSessionId);
      if (activeProjectIdRef.current !== scopeProjectId) return;
      const session = decorateSession(data.session, serverId);
      setSessions(prev => [...prev, session]);
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
        markServerForRestore(serverId);
        handleReconnectServer(serverId, { silent: true });
      } else {
        handleReconnectAll({ silent: true });
      }
      return;
    }
    if (options.reason === 'heartbeat_timeout' && sessionId) {
      const { serverId } = splitSessionId(sessionId);
      if (serverId) {
        handleReconnectServer(serverId, { silent: true });
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
      const wasOffline = prev[serverId]?.status === SERVER_HEALTH_STATUS.OFFLINE;
      const isOnline = entry?.status === SERVER_HEALTH_STATUS.ONLINE;
      if (wasOffline && isOnline) {
        handleReconnectServer(serverId, { silent: true });
        recoveredAny = true;
      }
    }
    previousHealthRef.current = serverHealth;
    if (recoveredAny && !recoveryFetchInFlightRef.current) {
      recoveryFetchInFlightRef.current = true;
      Promise.resolve(fetchSessions())
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
      reconnectServers(serverIds);
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
          reconnectServers(serverIds);
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
    <div className="flex flex-col h-full min-h-0">
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
        onRetest={fetchSessions}
      />
    </div>
  );
}
