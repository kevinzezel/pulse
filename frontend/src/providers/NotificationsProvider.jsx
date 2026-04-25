'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useServers } from '@/providers/ServersProvider';
import { useTranslation } from '@/providers/I18nProvider';
import { composeSessionId, splitSessionId } from '@/services/api';

const NotificationsContext = createContext(null);

const MUTE_STORAGE_KEY = 'rt:notify-mute';
const PRESENCE_POLICY_STORAGE_KEY = 'rt:notify-presence-policy';
const PRESENCE_POLICY_STRICT = 'strict';
const PRESENCE_POLICY_VISIBLE = 'visible';
const EVENT_DEDUPE_PREFIX = 'rt:notify-event:';
const EVENT_DEDUPE_TTL_MS = 10 * 60 * 1000;
const EVENT_DEDUPE_CHANNEL = 'rt:notify-dedupe';
const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000, 30000];
const CONNECTION_LOST_TOAST_DELAY_MS = 5000;
const handledEvents = new Map();
let dedupeChannel = null;

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
  if (typeof window === 'undefined') return PRESENCE_POLICY_STRICT;
  try {
    const value = localStorage.getItem(PRESENCE_POLICY_STORAGE_KEY);
    return value === PRESENCE_POLICY_VISIBLE ? PRESENCE_POLICY_VISIBLE : PRESENCE_POLICY_STRICT;
  } catch {
    return PRESENCE_POLICY_STRICT;
  }
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
  const { t } = useTranslation();
  const tRef = useRef(t);
  tRef.current = t;

  const [supported, setSupported] = useState(false);
  const [permission, setPermission] = useState('default');
  // 'insecure-context' means the browser won't even offer the permission
  // prompt (non-HTTPS / non-localhost). Everything else leaves it null.
  const [permissionReason, setPermissionReason] = useState(null);
  const [muted, setMutedState] = useState(false);
  const [presencePolicy, setPresencePolicyState] = useState(PRESENCE_POLICY_STRICT);

  const connectionsRef = useRef(new Map());
  const mutedRef = useRef(false);
  const permissionRef = useRef('default');

  mutedRef.current = muted;
  permissionRef.current = permission;

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
    setPresencePolicyState(readInitialPresencePolicy());
    ensureDedupeChannel();
  }, []);

  const setMuted = useCallback((value) => {
    setMutedState(value);
    try {
      localStorage.setItem(MUTE_STORAGE_KEY, value ? 'true' : 'false');
    } catch {}
  }, []);

  const setPresencePolicy = useCallback((value) => {
    const next = value === PRESENCE_POLICY_VISIBLE ? PRESENCE_POLICY_VISIBLE : PRESENCE_POLICY_STRICT;
    setPresencePolicyState(next);
    try {
      localStorage.setItem(PRESENCE_POLICY_STORAGE_KEY, next);
    } catch {}
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
    };

    const scheduleReconnect = () => {
      if (ctrl.closed) return;
      const delay = BACKOFF_MS[Math.min(ctrl.attempt, BACKOFF_MS.length - 1)];
      ctrl.attempt += 1;
      ctrl.reconnectTimer = setTimeout(open, delay);
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
          handleEvent(ctrl.serverId, msg);
        } catch {}
      };
      ws.onclose = () => {
        if (ctrl.closed) return;
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
