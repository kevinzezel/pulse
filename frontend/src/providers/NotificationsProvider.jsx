'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useServers } from '@/providers/ServersProvider';
import { SERVER_HEALTH_STATUS, useServerHealth } from '@/providers/ServerHealthProvider';
import { useTranslation } from '@/providers/I18nProvider';
import { composeSessionId, splitSessionId } from '@/services/api';

const NotificationsContext = createContext(null);

const MUTE_STORAGE_KEY = 'rt:notify-mute';
const PRESENCE_POLICY_STORAGE_KEY = 'rt:notify-presence-policy';
export const PRESENCE_POLICY_STRICT = 'strict';
export const PRESENCE_POLICY_SMART = 'smart';
export const PRESENCE_POLICY_VISIBLE = 'visible';
const VALID_POLICIES = new Set([PRESENCE_POLICY_STRICT, PRESENCE_POLICY_SMART, PRESENCE_POLICY_VISIBLE]);
// Padrão pra novas instalações: smart. Preferências salvas como strict/visible
// continuam valendo — não fazemos migração silenciosa.
const DEFAULT_PRESENCE_POLICY = PRESENCE_POLICY_SMART;
// Janela de atividade local. No modo strict é a única evidência de presença
// junto com foco. No modo smart é o fallback quando o IdleDetector não está
// disponível ou não foi autorizado.
const STRICT_ACTIVITY_THRESHOLD_MS = 30 * 1000;
const SMART_FALLBACK_ACTIVITY_THRESHOLD_MS = 2 * 60 * 1000;
// Threshold mínimo aceito pela Idle Detection API é 60s. Acima disso o
// detector reporta `idle` quando não há input de teclado/mouse no SO.
const IDLE_DETECTOR_THRESHOLD_MS = 60 * 1000;
const IDLE_DETECTION_STORAGE_KEY = 'rt:notify-idle-detection-armed';
const EVENT_DEDUPE_PREFIX = 'rt:notify-event:';
const EVENT_DEDUPE_TTL_MS = 10 * 60 * 1000;
const EVENT_DEDUPE_CHANNEL = 'rt:notify-dedupe';
const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000, 30000];
const MAX_RECONNECT_ATTEMPTS = 3;
const CONNECTION_LOST_TOAST_DELAY_MS = 5000;
const NOTIFICATIONS_WS_PING_INTERVAL_MS = 30000;
const NOTIFICATIONS_WS_PONG_TIMEOUT_MS = 5000;
const handledEvents = new Map();
let dedupeChannel = null;

// Atividade local: evento global, compartilhado por todos os TerminalPanes.
// Ouve qualquer interação física com a página (mouse/teclado/touch). Module-
// level pra que registros tardios (ex: terminal aberto depois) já encontrem o
// timestamp atualizado, sem depender da árvore de React.
let lastUserActivityTs = typeof window !== 'undefined' ? Date.now() : 0;
if (typeof window !== 'undefined') {
  const bumpActivity = () => { lastUserActivityTs = Date.now(); };
  ['mousemove', 'keydown', 'pointerdown', 'wheel', 'touchstart'].forEach((ev) => {
    window.addEventListener(ev, bumpActivity, { passive: true });
  });
}

export function getLastUserActivityTs() {
  return lastUserActivityTs;
}

function getSupported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

// Browsers require a "secure context" (HTTPS or localhost) for the
// Notifications API. In insecure contexts (plain HTTP on a non-localhost
// origin — the typical Pulse-over-LAN setup), requestPermission() either
// rejects or the API is undefined entirely. We detect that up front so
// the UI can explain *why* instead of just saying "denied".
export function isInsecureLan() {
  if (typeof window === 'undefined') return false;
  if (window.isSecureContext) return false;
  const h = window.location.hostname;
  return h !== 'localhost' && h !== '127.0.0.1' && h !== '::1';
}

function readInitialMute() {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(MUTE_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function readInitialPresencePolicy() {
  if (typeof window === 'undefined') return DEFAULT_PRESENCE_POLICY;
  try {
    const value = localStorage.getItem(PRESENCE_POLICY_STORAGE_KEY);
    if (value && VALID_POLICIES.has(value)) return value;
    return DEFAULT_PRESENCE_POLICY;
  } catch {
    return DEFAULT_PRESENCE_POLICY;
  }
}

function readInitialIdleDetectionArmed() {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(IDLE_DETECTION_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function isIdleDetectionSupported() {
  return typeof window !== 'undefined' && 'IdleDetector' in window;
}

function rememberEvent(eventId, ts = Date.now()) {
  handledEvents.set(eventId, ts);
  try {
    localStorage.setItem(`${EVENT_DEDUPE_PREFIX}${eventId}`, String(ts));
  } catch {}
}

function pruneHandledEvents(now = Date.now()) {
  for (const [eventId, ts] of handledEvents) {
    if (now - ts > EVENT_DEDUPE_TTL_MS) {
      handledEvents.delete(eventId);
      try { localStorage.removeItem(`${EVENT_DEDUPE_PREFIX}${eventId}`); } catch {}
    }
  }
}

function ensureDedupeChannel() {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return null;
  if (dedupeChannel) return dedupeChannel;
  dedupeChannel = new BroadcastChannel(EVENT_DEDUPE_CHANNEL);
  dedupeChannel.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || msg.type !== 'handled' || typeof msg.eventId !== 'string') return;
    rememberEvent(msg.eventId, typeof msg.ts === 'number' ? msg.ts : Date.now());
  });
  return dedupeChannel;
}

function claimEvent(eventId) {
  if (!eventId) return true;
  const now = Date.now();
  pruneHandledEvents(now);

  const localTs = handledEvents.get(eventId);
  if (localTs && now - localTs < EVENT_DEDUPE_TTL_MS) return false;

  try {
    const storedTs = Number(localStorage.getItem(`${EVENT_DEDUPE_PREFIX}${eventId}`) || 0);
    if (storedTs && now - storedTs < EVENT_DEDUPE_TTL_MS) {
      handledEvents.set(eventId, storedTs);
      return false;
    }
  } catch {}

  rememberEvent(eventId, now);
  try { ensureDedupeChannel()?.postMessage({ type: 'handled', eventId, ts: now }); } catch {}
  return true;
}

function buildEventId(serverId, event) {
  const raw = event?.event_id;
  if (typeof raw === 'string' && raw) return `${serverId}:${raw}`.slice(0, 256);
  return `${serverId}:${event?.session_id || ''}:${event?.timestamp || ''}:${event?.idle_seconds || ''}`.slice(0, 256);
}

const NOTIFY_SOUND_URL = '/sounds/notify.mp3';

function playSynthBeep() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.setValueAtTime(660, now + 0.14);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
    osc.start(now);
    osc.stop(now + 0.34);
    setTimeout(() => { try { ctx.close(); } catch {} }, 500);
  } catch {}
}

function playNotifySound() {
  try {
    const audio = new Audio(NOTIFY_SOUND_URL);
    audio.volume = 0.7;
    const playPromise = audio.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => playSynthBeep());
    }
  } catch {
    playSynthBeep();
  }
}

function connectionFields(server) {
  return `${server.host}::${server.port}::${server.apiKey}::${server.protocol || 'http'}`;
}

export function NotificationsProvider({ children }) {
  const { servers } = useServers();
  const { health: serverHealth } = useServerHealth();
  const { t } = useTranslation();
  const tRef = useRef(t);
  tRef.current = t;

  const [supported, setSupported] = useState(false);
  const [permission, setPermission] = useState('default');
  // 'insecure-context' means the browser won't even offer the permission
  // prompt (non-HTTPS / non-localhost). Everything else leaves it null.
  const [permissionReason, setPermissionReason] = useState(null);
  const [muted, setMutedState] = useState(false);
  const [presencePolicy, setPresencePolicyState] = useState(() => readInitialPresencePolicy());
  // Idle Detection: status reflete o ciclo da Browser Idle Detection API.
  //   unsupported       — browser sem IdleDetector
  //   unrequested       — suportado mas usuário ainda não pediu
  //   permission-denied — usuário negou permissão (ou bloqueio de policy)
  //   monitoring        — detector ativo, vamos confiar em userState/screenState
  //   failed            — start() rejeitou por outro motivo
  const [idleDetectionStatus, setIdleDetectionStatus] = useState('unsupported');
  const [idleUserState, setIdleUserState] = useState('active');
  const [idleScreenState, setIdleScreenState] = useState('unlocked');

  const connectionsRef = useRef(new Map());
  const mutedRef = useRef(false);
  const permissionRef = useRef('default');
  const presencePolicyRef = useRef(readInitialPresencePolicy());
  const idleDetectionStatusRef = useRef('unsupported');
  const idleUserStateRef = useRef('active');
  const idleScreenStateRef = useRef('unlocked');
  const idleDetectorRef = useRef(null);
  const idleDetectorAbortRef = useRef(null);

  mutedRef.current = muted;
  permissionRef.current = permission;
  presencePolicyRef.current = presencePolicy;
  idleDetectionStatusRef.current = idleDetectionStatus;
  idleUserStateRef.current = idleUserState;
  idleScreenStateRef.current = idleScreenState;

  useEffect(() => {
    setSupported(getSupported());
    if (getSupported()) {
      setPermission(Notification.permission);
    }
    if (isInsecureLan()) {
      setPermission('denied');
      setPermissionReason('insecure-context');
    }
    setMutedState(readInitialMute());
    setIdleDetectionStatus(isIdleDetectionSupported() ? 'unrequested' : 'unsupported');
    ensureDedupeChannel();
  }, []);

  const setMuted = useCallback((value) => {
    setMutedState(value);
    try {
      localStorage.setItem(MUTE_STORAGE_KEY, value ? 'true' : 'false');
    } catch {}
  }, []);

  const setPresencePolicy = useCallback((value) => {
    const next = VALID_POLICIES.has(value) ? value : DEFAULT_PRESENCE_POLICY;
    setPresencePolicyState(next);
    try {
      localStorage.setItem(PRESENCE_POLICY_STORAGE_KEY, next);
    } catch {}
  }, []);

  const stopIdleDetector = useCallback(() => {
    if (idleDetectorAbortRef.current) {
      try { idleDetectorAbortRef.current.abort(); } catch {}
      idleDetectorAbortRef.current = null;
    }
    idleDetectorRef.current = null;
  }, []);

  const startGrantedIdleDetector = useCallback(async () => {
    if (!isIdleDetectionSupported()) {
      setIdleDetectionStatus('unsupported');
      return 'unsupported';
    }
    stopIdleDetector();

    const controller = new AbortController();
    const detector = new window.IdleDetector();
    detector.addEventListener('change', () => {
      // Após `start()`, userState é 'active'|'idle' e screenState é
      // 'locked'|'unlocked'. Refs são lidas pelo canSendViewingHeartbeat.
      setIdleUserState(detector.userState || 'active');
      setIdleScreenState(detector.screenState || 'unlocked');
    });

    try {
      await detector.start({ threshold: IDLE_DETECTOR_THRESHOLD_MS, signal: controller.signal });
    } catch {
      setIdleDetectionStatus('failed');
      try { localStorage.removeItem(IDLE_DETECTION_STORAGE_KEY); } catch {}
      return 'failed';
    }

    idleDetectorRef.current = detector;
    idleDetectorAbortRef.current = controller;
    setIdleUserState(detector.userState || 'active');
    setIdleScreenState(detector.screenState || 'unlocked');
    setIdleDetectionStatus('monitoring');
    try { localStorage.setItem(IDLE_DETECTION_STORAGE_KEY, 'true'); } catch {}
    return 'monitoring';
  }, [stopIdleDetector]);

  const requestIdleDetection = useCallback(async () => {
    if (!isIdleDetectionSupported()) {
      setIdleDetectionStatus('unsupported');
      return 'unsupported';
    }
    // requestPermission() exige transient user activation pela spec. Este
    // caminho só roda a partir do clique em Settings; re-arm posterior usa
    // startGrantedIdleDetector() direto após permissions.query === 'granted'.
    try {
      const permissionState = await window.IdleDetector.requestPermission();
      if (permissionState !== 'granted') {
        setIdleDetectionStatus('permission-denied');
        try { localStorage.removeItem(IDLE_DETECTION_STORAGE_KEY); } catch {}
        return 'permission-denied';
      }
    } catch {
      setIdleDetectionStatus('permission-denied');
      try { localStorage.removeItem(IDLE_DETECTION_STORAGE_KEY); } catch {}
      return 'permission-denied';
    }
    return startGrantedIdleDetector();
  }, [startGrantedIdleDetector]);

  // Re-arma o detector silenciosamente em sessões futuras se o usuário já
  // tinha autorizado antes. start() não pede gesto se a permissão já está
  // 'granted'. Falhas viram unrequested/permission-denied dependendo do caso.
  useEffect(() => {
    if (!isIdleDetectionSupported()) return;
    if (!readInitialIdleDetectionArmed()) return;
    let cancelled = false;
    (async () => {
      try {
        if (!navigator.permissions?.query) return;
        const perm = await navigator.permissions.query({ name: 'idle-detection' });
        if (cancelled) return;
        if (perm.state !== 'granted') {
          setIdleDetectionStatus(perm.state === 'denied' ? 'permission-denied' : 'unrequested');
          return;
        }
        await startGrantedIdleDetector();
      } catch {
        // permissions.query pode lançar pra nomes desconhecidos; ignora.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [startGrantedIdleDetector]);

  useEffect(() => () => stopIdleDetector(), [stopIdleDetector]);

  // Helper síncrono pra ser chamado dentro do setInterval de heartbeat sem
  // forçar re-render do TerminalPane. Lê tudo via ref.
  const canSendViewingHeartbeat = useCallback(() => {
    const policy = presencePolicyRef.current;
    if (policy === PRESENCE_POLICY_VISIBLE) return true;
    if (policy === PRESENCE_POLICY_STRICT) {
      if (typeof document === 'undefined') return false;
      if (!document.hasFocus()) return false;
      return Date.now() - lastUserActivityTs <= STRICT_ACTIVITY_THRESHOLD_MS;
    }
    // smart
    const status = idleDetectionStatusRef.current;
    if (status === 'monitoring') {
      if (idleScreenStateRef.current === 'locked') return false;
      if (idleUserStateRef.current === 'idle') return false;
      return true;
    }
    // Fallback: sem IdleDetector (ou negado/falho), confiamos só em
    // atividade local recente — sem exigir foco. Janela maior que strict
    // pra dar margem ao uso multi-monitor.
    return Date.now() - lastUserActivityTs <= SMART_FALLBACK_ACTIVITY_THRESHOLD_MS;
  }, []);

  const requestBrowserPermission = useCallback(async () => {
    if (!getSupported()) return 'unsupported';
    if (isInsecureLan()) {
      setPermission('denied');
      setPermissionReason('insecure-context');
      return 'denied';
    }
    if (Notification.permission === 'granted') {
      setPermission('granted');
      setPermissionReason(null);
      return 'granted';
    }
    if (Notification.permission === 'denied') {
      setPermission('denied');
      return 'denied';
    }
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== 'denied') setPermissionReason(null);
      return result;
    } catch {
      return 'default';
    }
  }, []);

  const handleEvent = useCallback((serverId, event) => {
    if (!event || event.type !== 'idle') return;
    const backendSessionId = event.session_id;
    if (!backendSessionId) return;
    if (!claimEvent(buildEventId(serverId, event))) return;
    const composedId = composeSessionId(serverId, backendSessionId);
    const name = event.name || backendSessionId;
    const tr = tRef.current;
    // Sempre monta "{projeto} › {grupo} › {terminal}". Fallbacks defensivos
    // pra sessões legadas (criadas antes do fix, sem labels persistidos).
    const projectLabel =
      (typeof event.project_name === 'string' && event.project_name) || tr('projects.defaultName');
    const groupLabel =
      (typeof event.group_name === 'string' && event.group_name) || tr('sidebar.noGroup');
    const context = `${projectLabel} › ${groupLabel} › ${name}`;
    const idleSeconds = Number(event.idle_seconds) || 0;
    const snippet = typeof event.snippet === 'string' ? event.snippet : '';

    const title = tr('notifications.idleTitle', { context });
    const body = tr('notifications.idleBody', { idleSeconds });

    toast(title, { icon: '🔔', duration: 6000 });

    if (!mutedRef.current) playNotifySound();

    if (getSupported() && permissionRef.current === 'granted') {
      try {
        const snippetTrimmed = snippet.length > 180 ? snippet.slice(-180) : snippet;
        const fullBody = snippetTrimmed ? `${body}\n${snippetTrimmed}` : body;
        const notificationTag = event.event_id ? `${composedId}:${event.event_id}`.slice(0, 256) : composedId;
        new Notification(title, {
          body: fullBody,
          tag: notificationTag,
          renotify: false,
          icon: '/favicon.ico',
        });
      } catch {}
    }
  }, []);

  const sendViewing = useCallback((compositeId) => {
    const { serverId, sessionId } = splitSessionId(compositeId);
    if (!serverId || !sessionId) return false;
    const ctrl = connectionsRef.current.get(serverId);
    const ws = ctrl?.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(JSON.stringify({ type: 'viewing', session_id: sessionId }));
      return true;
    } catch {
      return false;
    }
  }, []);

  const connectServer = useCallback((server) => {
    const fields = connectionFields(server);
    const wsScheme = server.protocol === 'https' ? 'wss' : 'ws';
    const wsUrl = `${wsScheme}://${server.host}:${server.port}/ws/notifications`;

    const ctrl = {
      serverId: server.id,
      fields,
      ws: null,
      attempt: 0,
      closed: false,
      reconnectTimer: null,
      disconnectedAt: 0,
      lostToastShownId: null,
      manualRetryRequired: false,
      pingTimer: null,
      pongTimer: null,
      lastPingTs: 0,
      lastPongTs: 0,
    };

    const scheduleReconnect = () => {
      if (ctrl.closed) return;
      if (ctrl.reconnectTimer) return;
      if (ctrl.attempt >= MAX_RECONNECT_ATTEMPTS) {
        ctrl.manualRetryRequired = true;
        return;
      }
      const delay = BACKOFF_MS[Math.min(ctrl.attempt, BACKOFF_MS.length - 1)];
      ctrl.attempt += 1;
      ctrl.reconnectTimer = setTimeout(() => {
        ctrl.reconnectTimer = null;
        open();
      }, delay);
    };

    const stopHealthProbe = () => {
      if (ctrl.pingTimer) {
        clearInterval(ctrl.pingTimer);
        ctrl.pingTimer = null;
      }
      if (ctrl.pongTimer) {
        clearTimeout(ctrl.pongTimer);
        ctrl.pongTimer = null;
      }
    };

    const startHealthProbe = (ws) => {
      stopHealthProbe();
      const ping = () => {
        if (ctrl.closed || ctrl.ws !== ws || ws.readyState !== WebSocket.OPEN) return;
        const pingTs = Date.now();
        ctrl.lastPingTs = pingTs;
        try {
          ws.send(JSON.stringify({ type: 'ping' }));
        } catch {
          try { ws.close(); } catch {}
          scheduleReconnect();
          return;
        }
        if (ctrl.pongTimer) clearTimeout(ctrl.pongTimer);
        ctrl.pongTimer = setTimeout(() => {
          if (ctrl.closed || ctrl.ws !== ws) return;
          if ((ctrl.lastPongTs || 0) >= pingTs) return;
          try { ws.close(); } catch {}
          scheduleReconnect();
        }, NOTIFICATIONS_WS_PONG_TIMEOUT_MS);
      };
      ctrl.pingTimer = setInterval(ping, NOTIFICATIONS_WS_PING_INTERVAL_MS);
    };

    function open() {
      if (ctrl.closed) return;
      let ws;
      try {
        ws = new WebSocket(wsUrl, [`apikey.${server.apiKey}`]);
      } catch {
        scheduleReconnect();
        return;
      }
      ctrl.ws = ws;
      ws.onopen = () => {
        ctrl.attempt = 0;
        ctrl.manualRetryRequired = false;
        ctrl.lastPongTs = Date.now();
        startHealthProbe(ws);
        if (ctrl.disconnectedAt && Date.now() - ctrl.disconnectedAt > CONNECTION_LOST_TOAST_DELAY_MS) {
          const tr = tRef.current;
          if (ctrl.lostToastShownId) {
            toast.dismiss(ctrl.lostToastShownId);
            ctrl.lostToastShownId = null;
          }
          toast.success(tr('notifications.connectionRestored'), { duration: 2500 });
        }
        ctrl.disconnectedAt = 0;
      };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg?.type === 'pong') {
            ctrl.lastPongTs = Date.now();
            return;
          }
          handleEvent(ctrl.serverId, msg);
        } catch {}
      };
      ws.onclose = () => {
        if (ctrl.ws !== ws) return;
        if (ctrl.closed) return;
        stopHealthProbe();
        if (!ctrl.disconnectedAt) {
          ctrl.disconnectedAt = Date.now();
          setTimeout(() => {
            if (!ctrl.closed && ctrl.ws?.readyState !== WebSocket.OPEN && !ctrl.lostToastShownId) {
              const tr = tRef.current;
              ctrl.lostToastShownId = toast.loading(tr('notifications.connectionLost'));
            }
          }, CONNECTION_LOST_TOAST_DELAY_MS);
        }
        scheduleReconnect();
      };
      ws.onerror = () => {};
    }

    open();
    return ctrl;
  }, [handleEvent]);

  const closeConnection = useCallback((ctrl) => {
    ctrl.closed = true;
    if (ctrl.reconnectTimer) {
      clearTimeout(ctrl.reconnectTimer);
      ctrl.reconnectTimer = null;
    }
    if (ctrl.pingTimer) {
      clearInterval(ctrl.pingTimer);
      ctrl.pingTimer = null;
    }
    if (ctrl.pongTimer) {
      clearTimeout(ctrl.pongTimer);
      ctrl.pongTimer = null;
    }
    if (ctrl.lostToastShownId) {
      toast.dismiss(ctrl.lostToastShownId);
      ctrl.lostToastShownId = null;
    }
    try { ctrl.ws?.close(); } catch {}
  }, []);

  useEffect(() => {
    const connections = connectionsRef.current;
    const nextIds = new Set(servers.map(s => s.id));

    for (const [id, ctrl] of connections) {
      if (!nextIds.has(id)) {
        closeConnection(ctrl);
        connections.delete(id);
      }
    }

    for (const server of servers) {
      const existing = connections.get(server.id);
      const fields = connectionFields(server);
      if (existing) {
        if (existing.fields === fields) continue;
        closeConnection(existing);
        connections.delete(server.id);
      }
      const ctrl = connectServer(server);
      connections.set(server.id, ctrl);
    }

    return () => {};
  }, [servers, connectServer, closeConnection]);

  useEffect(() => {
    const connections = connectionsRef.current;
    for (const server of servers) {
      const ctrl = connections.get(server.id);
      if (!ctrl?.manualRetryRequired) continue;
      if (serverHealth[server.id]?.status !== SERVER_HEALTH_STATUS.ONLINE) continue;
      closeConnection(ctrl);
      connections.delete(server.id);
      const next = connectServer(server);
      connections.set(server.id, next);
    }
  }, [serverHealth, servers, connectServer, closeConnection]);

  useEffect(() => {
    return () => {
      const connections = connectionsRef.current;
      for (const ctrl of connections.values()) closeConnection(ctrl);
      connections.clear();
    };
  }, [closeConnection]);

  const value = {
    supported,
    permission,
    permissionReason,
    requestBrowserPermission,
    muted,
    setMuted,
    presencePolicy,
    setPresencePolicy,
    idleDetectionStatus,
    idleUserState,
    idleScreenState,
    requestIdleDetection,
    canSendViewingHeartbeat,
    sendViewing,
  };

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error('useNotifications must be used within NotificationsProvider');
  return ctx;
}
