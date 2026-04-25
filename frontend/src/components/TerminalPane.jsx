'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useTheme } from '@/providers/ThemeProvider';
import { useTranslation } from '@/providers/I18nProvider';
import { useNotifications } from '@/providers/NotificationsProvider';
import { getServerById } from '@/providers/ServersProvider';
import { splitSessionId } from '@/services/api';
import { getXtermTheme } from '@/themes/xterm';

const terminalCache = new Map();

// Subscribers por sessionId pra reagir a mudanças de conectividade do WS sem
// precisar pollar terminalCache. Usado pelo FAB de ações (engrenagem) pra
// desabilitar e fechar quando a sessão perde a conexão.
const connectionListeners = new Map();

function notifyConnection(sessionId) {
  const set = connectionListeners.get(sessionId);
  if (!set) return;
  const connected = isTerminalConnected(sessionId);
  for (const cb of set) {
    try { cb(connected); } catch {}
  }
}

export function isTerminalConnected(sessionId) {
  const entry = terminalCache.get(sessionId);
  return entry?.ws?.readyState === WebSocket.OPEN && entry.streamActive === true;
}

export function getTerminalConnectionState(sessionId) {
  const entry = terminalCache.get(sessionId);
  if (!entry || !entry.ws) return 'absent';
  switch (entry.ws.readyState) {
    case WebSocket.CONNECTING: return 'connecting';
    case WebSocket.OPEN: return entry.streamActive ? 'open' : 'connecting';
    case WebSocket.CLOSING: return 'closing';
    default: return 'closed';
  }
}

export function subscribeTerminalConnection(sessionId, cb) {
  if (!sessionId || typeof cb !== 'function') return () => {};
  let set = connectionListeners.get(sessionId);
  if (!set) {
    set = new Set();
    connectionListeners.set(sessionId, set);
  }
  set.add(cb);
  return () => {
    const cur = connectionListeners.get(sessionId);
    if (!cur) return;
    cur.delete(cb);
    if (cur.size === 0) connectionListeners.delete(sessionId);
  };
}

// Heartbeat de presença ("tô olhando"): cada TerminalPane manda a cada 10s pelo
// WS multi-cliente de notificações SE a aba está visível e o terminal está na
// viewport. A decisão final por modo de presença (strict / smart / visible)
// vive em NotificationsProvider.canSendViewingHeartbeat().
// O backend usa esse sinal pra suprimir alerta idle (Rule 5 do watcher).
const VIEWING_HEARTBEAT_MS = 10000;

export function destroyAllTerminals() {
  for (const id of [...terminalCache.keys()]) {
    destroyTerminal(id);
  }
}

export function destroyTerminal(sessionId) {
  const entry = terminalCache.get(sessionId);
  if (!entry) return;
  entry.resizeObserver?.disconnect();
  entry.removeTouchHandlers?.();
  entry.onDataDisposable?.dispose();
  if (entry.ws && (entry.ws.readyState === WebSocket.OPEN || entry.ws.readyState === WebSocket.CONNECTING)) {
    entry.ws.close();
  }
  entry.terminal?.dispose();
  terminalCache.delete(sessionId);
  notifyConnection(sessionId);
}

export function destroyTerminalsByServerId(serverId) {
  if (!serverId) return;
  const prefix = `${serverId}::`;
  for (const id of [...terminalCache.keys()]) {
    if (id.startsWith(prefix)) {
      destroyTerminal(id);
    }
  }
}

export function applyXtermThemeToAll(theme) {
  const xtermTheme = getXtermTheme(theme);
  for (const entry of terminalCache.values()) {
    if (entry.terminal) {
      entry.terminal.options.theme = xtermTheme;
    }
  }
}

export function sendKey(sessionId, data) {
  const entry = terminalCache.get(sessionId);
  if (entry?.ws?.readyState !== WebSocket.OPEN) return false;
  try {
    entry.ws.send(JSON.stringify({ type: 'input', data }));
    return true;
  } catch {
    return false;
  }
}

export function hasDeadConnections() {
  if (terminalCache.size === 0) return false;
  for (const entry of terminalCache.values()) {
    const rs = entry.ws?.readyState;
    if (rs !== WebSocket.OPEN && rs !== WebSocket.CONNECTING) {
      return true;
    }
  }
  return false;
}

// Probe ativo de saúde do WS: envia ping e espera pong em `timeoutMs`.
// Resolve true se vivo, false se zumbi/sem entry/sem WS aberto.
// Necessário porque `WebSocket.readyState` mente "OPEN" quando o TCP morre
// silenciosamente (sem FIN/RST) — comum no mobile após tab freezing e no
// desktop após suspend/Wi-Fi flap. Sem isto, hasDeadConnections() falha em
// detectar zumbis e a reconexão automática nunca dispara.
export function probeTerminal(sessionId, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const entry = terminalCache.get(sessionId);
    if (!entry || !entry.ws || entry.ws.readyState !== WebSocket.OPEN) {
      resolve(false);
      return;
    }
    const pingTs = Date.now();
    entry.lastPingTs = pingTs;
    try {
      entry.ws.send(JSON.stringify({ type: 'ping' }));
    } catch {
      resolve(false);
      return;
    }
    // Polling barato: o pong atualiza entry.lastPongTs no onmessage.
    const intervalId = setInterval(() => {
      const cur = terminalCache.get(sessionId);
      if (!cur || cur !== entry) {
        clearInterval(intervalId);
        clearTimeout(timer);
        resolve(false);
        return;
      }
      if ((cur.lastPongTs || 0) >= pingTs) {
        clearInterval(intervalId);
        clearTimeout(timer);
        resolve(true);
      }
    }, 50);
    const timer = setTimeout(() => {
      clearInterval(intervalId);
      resolve(false);
    }, timeoutMs);
  });
}

export async function probeAllTerminals(timeoutMs = 2000) {
  if (terminalCache.size === 0) return false;
  const ids = [...terminalCache.keys()];
  const results = await Promise.all(ids.map((id) => probeTerminal(id, timeoutMs)));
  return results.some((alive) => !alive);
}

export default function TerminalPane({ session, onSessionEnded, onReconnect, isMobile = false }) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { sendViewing, canSendViewingHeartbeat } = useNotifications();
  const slotRef = useRef(null);
  const onSessionEndedRef = useRef(onSessionEnded);
  const onReconnectRef = useRef(onReconnect);
  const tRef = useRef(t);
  const isMobileRef = useRef(isMobile);
  onSessionEndedRef.current = onSessionEnded;
  onReconnectRef.current = onReconnect;
  tRef.current = t;
  isMobileRef.current = isMobile;

  useEffect(() => {
    applyXtermThemeToAll(theme);
  }, [theme]);

  const setupResizeObserver = useCallback((entry, observeTarget) => {
    entry.resizeObserver?.disconnect();
    entry.resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        if (entry.fitAddon && entry.container.parentNode) {
          entry.fitAddon.fit();
          if (entry.ws && entry.ws.readyState === WebSocket.OPEN) {
            entry.ws.send(JSON.stringify({
              type: 'resize',
              cols: entry.terminal.cols,
              rows: entry.terminal.rows,
            }));
          }
        }
      });
    });
    entry.resizeObserver.observe(observeTarget);
  }, []);

  useEffect(() => {
    const cached = terminalCache.get(session.id);

    if (cached) {
      if (slotRef.current && cached.container) {
        slotRef.current.appendChild(cached.container);
        setupResizeObserver(cached, slotRef.current);
        requestAnimationFrame(() => cached.fitAddon?.fit());
      }
      return () => {
        cached.resizeObserver?.disconnect();
        if (cached.container?.parentNode) {
          cached.container.parentNode.removeChild(cached.container);
        }
      };
    }

    let cancelled = false;

    async function init() {
      const { Terminal } = await import('@xterm/xterm');
      const { FitAddon } = await import('@xterm/addon-fit');
      await import('@xterm/xterm/css/xterm.css');

      if (cancelled || !slotRef.current) return;

      const container = document.createElement('div');
      container.style.height = '100%';
      container.style.width = '100%';
      slotRef.current.appendChild(container);

      const terminal = new Terminal({
        cursorBlink: true,
        fontSize: isMobileRef.current ? 12 : 14,
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
        scrollback: 50000,
        lineHeight: 1.1,
        theme: getXtermTheme(theme),
      });

      // Defense-in-depth for ED3 (CSI 3 J — "Erase scrollback"). Anything
      // that emits ED3 (e.g. Claude Code's startup sequence) would otherwise
      // trigger xterm.js's default handler which trims scrollback down to
      // exactly the viewport height of lines (InputHandler.ts:1228).
      // Return true marks it as handled (no-op) so user history survives
      // Claude Code / compact / similar redraws. ED0/1/2 pass through so
      // plain `clear`, vim-style repaints, etc. keep working normally.
      terminal.parser.registerCsiHandler({ final: 'J' }, (params) => {
        const p = params[0];
        const code = Array.isArray(p) ? p[0] : p;
        return code === 3;
      });

      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(container);
      fitAddon.fit();

      if (cancelled) {
        terminal.dispose();
        return;
      }

      const { serverId, sessionId: backendId } = splitSessionId(session.id);
      const server = getServerById(serverId);
      if (!server) {
        const tr = tRef.current;
        terminal.write(`\r\n\x1b[31m[${tr('terminal.serverNotConfigured')}]\x1b[0m\r\n`);
        return;
      }
      const wsScheme = server.protocol === 'https' ? 'wss' : 'ws';
      const wsUrl = `${wsScheme}://${server.host}:${server.port}/ws/${backendId}`;
      const ws = new WebSocket(wsUrl, [`apikey.${server.apiKey}`]);

      ws.onopen = () => {
        const cur = terminalCache.get(session.id);
        if (cur) cur.streamActive = true;
        ws.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }));
        notifyConnection(session.id);
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'output') {
          // Cancel any user scroll-up on each chunk so TUI apps (claude-code,
          // htop, vim) that repaint near the cursor don't turn the viewport
          // into a teleprompter: top of the viewport frozen at the stale
          // scroll offset while the repaint region FIFOs underneath as the
          // buffer grows. Matches default behavior of iTerm2/gnome-terminal.
          terminal.write(msg.data, () => terminal.scrollToBottom());
        } else if (msg.type === 'pong') {
          const cur = terminalCache.get(session.id);
          if (cur) cur.lastPongTs = Date.now();
        }
      };

      ws.onclose = (event) => {
        const cur = terminalCache.get(session.id);
        if (cur?.ws === ws) cur.streamActive = false;
        notifyConnection(session.id);
        const tr = tRef.current;
        if (event.code === 1000 && event.reason === 'Session ended') {
          onSessionEndedRef.current?.();
        } else if (event.code === 4000) {
          terminal.write(`\r\n\x1b[33m[${tr('terminal.connectionReplaced')}]\x1b[0m\r\n`);
        } else {
          terminal.write(`\r\n\x1b[31m[${tr('terminal.connectionLost')}]\x1b[0m\r\n`);
        }
      };

      ws.onerror = () => {
        const tr = tRef.current;
        terminal.write(`\r\n\x1b[31m[${tr('terminal.connectionError')}]\x1b[0m\r\n`);
      };

      let lastOnDataTs = 0;
      const onDataDisposable = terminal.onData((data) => {
        lastOnDataTs = Date.now();
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'input', data }));
        }
      });

      const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);
      const xtermTextarea = container.querySelector('textarea.xterm-helper-textarea');

      if (xtermTextarea) {
        xtermTextarea.setAttribute('autocomplete', 'off');
        xtermTextarea.setAttribute('autocorrect', 'off');
        xtermTextarea.setAttribute('autocapitalize', 'off');
        xtermTextarea.setAttribute('spellcheck', 'false');

        if (isMac) {
          terminal.attachCustomKeyEventHandler((event) => {
            if (event.type === 'keydown' && event.altKey && !event.ctrlKey && !event.metaKey) {
              return false;
            }
            return true;
          });
        }

        xtermTextarea.addEventListener('input', (e) => {
          if (e.inputType === 'insertText' && e.data && !e.isComposing) {
            setTimeout(() => {
              if (Date.now() - lastOnDataTs > 30 && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'input', data: e.data }));
              }
            }, 20);
          }
        });

        xtermTextarea.addEventListener('compositionend', (e) => {
          if (!e.data) return;
          setTimeout(() => {
            if (Date.now() - lastOnDataTs > 30 && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'input', data: e.data }));
            }
          }, 20);
        });
      }

      const TOUCH_STEP_PX = 6;
      const TOUCH_MAX_STEPS_PER_MOVE = 40;
      let touchLastY = null;
      let touchAccumulator = 0;

      // Decide entre mouse SGR (apps que pediram mouse tracking — vim, htop,
      // less, Claude Code, etc) e scroll local do xterm.js (shell normal).
      // Sem essa distinção, arrastar o dedo num bash prompt cuspe bytes
      // `\x1b[<65;1;1M` no stdin do shell, que ecoa fragmentos como lixo
      // visível no prompt.
      function sendScrollStep(direction) {
        // direction: -1 = back (history mais antigo) | +1 = forward
        const mode = terminal.modes?.mouseTrackingMode;
        const hasMouseTracking = mode && mode !== 'none';
        if (hasMouseTracking) {
          if (ws.readyState !== WebSocket.OPEN) return;
          const cb = direction < 0 ? 64 : 65;
          ws.send(JSON.stringify({ type: 'input', data: `\x1b[<${cb};1;1M` }));
        } else {
          terminal.scrollLines(direction);
        }
      }

      function onTouchStart(e) {
        if (e.touches.length !== 1) {
          touchLastY = null;
          return;
        }
        touchLastY = e.touches[0].clientY;
        touchAccumulator = 0;
      }

      function onTouchMove(e) {
        if (touchLastY === null || e.touches.length !== 1) return;
        e.preventDefault();
        const currentY = e.touches[0].clientY;
        touchAccumulator += touchLastY - currentY;
        touchLastY = currentY;
        let steps = 0;
        while (Math.abs(touchAccumulator) >= TOUCH_STEP_PX && steps < TOUCH_MAX_STEPS_PER_MOVE) {
          if (touchAccumulator < 0) {
            sendScrollStep(-1);
            touchAccumulator += TOUCH_STEP_PX;
          } else {
            sendScrollStep(1);
            touchAccumulator -= TOUCH_STEP_PX;
          }
          steps++;
        }
      }

      function onTouchEnd() {
        // Flush any residual accumulator before resetting. Without this, a
        // fast flick whose final `touchmove` hit the per-event cap would
        // leave unsent steps that vanish when the finger lifts — the user
        // sees the flick "not respond". Direction matches onTouchMove
        // (negative accumulator = back, positive = forward).
        let steps = 0;
        while (Math.abs(touchAccumulator) >= TOUCH_STEP_PX && steps < 100) {
          if (touchAccumulator < 0) {
            sendScrollStep(-1);
            touchAccumulator += TOUCH_STEP_PX;
          } else {
            sendScrollStep(1);
            touchAccumulator -= TOUCH_STEP_PX;
          }
          steps++;
        }
        touchLastY = null;
        touchAccumulator = 0;
      }

      container.addEventListener('touchstart', onTouchStart, { passive: true });
      container.addEventListener('touchmove', onTouchMove, { passive: false });
      container.addEventListener('touchend', onTouchEnd, { passive: true });
      container.addEventListener('touchcancel', onTouchEnd, { passive: true });

      const removeTouchHandlers = () => {
        container.removeEventListener('touchstart', onTouchStart);
        container.removeEventListener('touchmove', onTouchMove);
        container.removeEventListener('touchend', onTouchEnd);
        container.removeEventListener('touchcancel', onTouchEnd);
      };

      const entry = { terminal, fitAddon, ws, container, onDataDisposable, resizeObserver: null, removeTouchHandlers, streamActive: false };
      terminalCache.set(session.id, entry);
      setupResizeObserver(entry, slotRef.current);
    }

    init();

    return () => {
      cancelled = true;
      const entry = terminalCache.get(session.id);
      if (entry) {
        entry.resizeObserver?.disconnect();
        if (entry.container?.parentNode) {
          entry.container.parentNode.removeChild(entry.container);
        }
      }
    };
  }, [session.id, setupResizeObserver]);

  // Refit quando o teclado virtual abre/fecha no mobile. O viewport meta
  // (`interactiveWidget: 'resizes-content'` em app/layout.js) pede ao browser
  // para encolher a área visível em vez de cobrir o conteúdo, mas o container
  // do terminal mantém suas dimensões físicas no DOM (flex layout não
  // colapsa) — o ResizeObserver não dispara, o fitAddon não recalcula e o
  // cursor (que estava perto do bottom) acaba encoberto pelo teclado.
  // Listener no visualViewport.resize força um refit + envia novo SIGWINCH
  // ao shell + scrolla pro bottom. Debounce 80ms pra absorver o jitter de
  // animação do teclado em iOS/Android.
  // Gate em pointer:coarse pra não disparar redundante em desktop, onde o
  // ResizeObserver já cobre todo redimensionamento real (o vv.resize aqui
  // só dispararia em zoom in/out — benigno mas evitável).
  useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) return;
    if (!window.matchMedia?.('(pointer: coarse)').matches) return;
    const vv = window.visualViewport;
    let timer = null;
    const refit = () => {
      timer = null;
      const entry = terminalCache.get(session.id);
      if (!entry?.fitAddon || !entry.terminal) return;
      try {
        entry.fitAddon.fit();
        if (entry.ws?.readyState === WebSocket.OPEN) {
          entry.ws.send(JSON.stringify({
            type: 'resize',
            cols: entry.terminal.cols,
            rows: entry.terminal.rows,
          }));
        }
        entry.terminal.scrollToBottom();
      } catch {}
    };
    const onResize = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(refit, 80);
    };
    vv.addEventListener('resize', onResize);
    return () => {
      vv.removeEventListener('resize', onResize);
      if (timer) clearTimeout(timer);
    };
  }, [session.id]);

  // "Tô olhando": IntersectionObserver no slot + heartbeat 10s pelo WS de
  // notificações. Como esse WS aceita múltiplos clientes, abrir a mesma sessão
  // no celular não derruba a presença do desktop (o WS do terminal continua
  // exclusivo e pode ser substituído).
  // Reage a montar/desmontar do componente (trocou de grupo / mosaico re-mount):
  // o intervalo é recriado no mount, parado no unmount → backend esquece após
  // VIEWING_GRACE_SECONDS (15s) e alerta volta a poder disparar.
  //
  // Default conservador (false) e bootstrap síncrono via getBoundingClientRect:
  // o IO antes inicializava em true (otimista), mas após remount entre grupos
  // ele podia disparar uma vez com isIntersecting=false enquanto o slot ainda
  // tinha rect zero (flex layout não consolidado), e ficava preso porque a
  // transição "rect zero → rect cheio" não cruza o threshold de 0.1.
  // Ler o rect direto no mount evita esse lock-in.
  const intersectingRef = useRef(false);
  useEffect(() => {
    const slot = slotRef.current;
    if (!slot) return;
    const rect = slot.getBoundingClientRect();
    intersectingRef.current = rect.width > 0 && rect.height > 0;
    const obs = new IntersectionObserver(([entry]) => {
      intersectingRef.current = entry.isIntersecting;
    }, { threshold: 0.1 });
    obs.observe(slot);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const sendHeartbeat = () => {
      const entry = terminalCache.get(session.id);
      const fallbackWs = entry?.ws;
      if (typeof document === 'undefined') return;
      if (document.visibilityState !== 'visible') return;
      if (!intersectingRef.current) {
        // Reconciliação: se o IO ficou preso em false após remount mas o slot
        // está visível agora (rect > 0), recupera. Custa um getBoundingClientRect
        // a cada 10s só quando o ref está false — desprezível.
        const slot = slotRef.current;
        if (!slot) return;
        const rect = slot.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        intersectingRef.current = true;
      }
      if (!canSendViewingHeartbeat()) return;
      if (!entry?.streamActive || fallbackWs?.readyState !== WebSocket.OPEN) return;
      sendViewing(session.id);
      try { fallbackWs.send(JSON.stringify({ type: 'viewing' })); } catch {}
    };
    sendHeartbeat();
    const id = setInterval(sendHeartbeat, VIEWING_HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [session.id, sendViewing, canSendViewingHeartbeat]);

  // Heartbeat passivo de saúde do WS de terminal: a cada 30s, manda ping e
  // espera pong em 5s. Se estourar, considera zumbi e chama onReconnect()
  // direto — sem isso, suspend/Wi-Fi flap em desktop com aba em foco deixa
  // o WS num estado "OPEN mas TCP morto" que readyState não revela e a
  // reconexão automática (gated por hasDeadConnections) nunca dispara.
  // Independente do `viewing` (frequência e gates diferentes); só roda com
  // a aba visível pra não disparar reconexão durante tab freezing no mobile.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const PING_INTERVAL_MS = 30000;
    const PONG_TIMEOUT_MS = 5000;
    let timeoutId = null;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      if (document.visibilityState !== 'visible') return;
      const entry = terminalCache.get(session.id);
      if (!entry || !entry.ws || entry.ws.readyState !== WebSocket.OPEN) return;
      const pingTs = Date.now();
      entry.lastPingTs = pingTs;
      try {
        entry.ws.send(JSON.stringify({ type: 'ping' }));
      } catch {
        return;
      }
      timeoutId = setTimeout(() => {
        if (cancelled) return;
        const cur = terminalCache.get(session.id);
        if (!cur) return;
        if ((cur.lastPongTs || 0) < pingTs) {
          onReconnectRef.current?.();
        }
      }, PONG_TIMEOUT_MS);
    };
    const intervalId = setInterval(tick, PING_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [session.id]);

  return (
    <div className="flex flex-col overflow-hidden" style={{ height: '100%', background: 'hsl(var(--terminal-bg))' }}>
      <div ref={slotRef} className="flex-1 min-h-0 min-w-0" />
    </div>
  );
}
