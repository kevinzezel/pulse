'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useTheme } from '@/providers/ThemeProvider';
import { useTranslation } from '@/providers/I18nProvider';
import { getServerById } from '@/providers/ServersProvider';
import { splitSessionId } from '@/services/api';
import { getXtermTheme } from '@/themes/xterm';

const terminalCache = new Map();

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
  if (entry?.ws?.readyState === WebSocket.OPEN) {
    entry.ws.send(JSON.stringify({ type: 'input', data }));
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

export default function TerminalPane({ session, onSessionEnded, isMobile = false }) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const slotRef = useRef(null);
  const onSessionEndedRef = useRef(onSessionEnded);
  const tRef = useRef(t);
  const isMobileRef = useRef(isMobile);
  onSessionEndedRef.current = onSessionEnded;
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
        ws.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }));
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'output') {
          terminal.write(msg.data);
        }
      };

      ws.onclose = (event) => {
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

      const TOUCH_STEP_PX = 24;
      const TOUCH_MAX_STEPS_PER_MOVE = 5;
      let touchLastY = null;
      let touchAccumulator = 0;

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
        if (ws.readyState !== WebSocket.OPEN) return;
        const currentY = e.touches[0].clientY;
        touchAccumulator += touchLastY - currentY;
        touchLastY = currentY;
        let steps = 0;
        while (Math.abs(touchAccumulator) >= TOUCH_STEP_PX && steps < TOUCH_MAX_STEPS_PER_MOVE) {
          if (touchAccumulator < 0) {
            ws.send(JSON.stringify({ type: 'input', data: '\x1b[<64;1;1M' }));
            touchAccumulator += TOUCH_STEP_PX;
          } else {
            ws.send(JSON.stringify({ type: 'input', data: '\x1b[<65;1;1M' }));
            touchAccumulator -= TOUCH_STEP_PX;
          }
          steps++;
        }
      }

      function onTouchEnd() {
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

      const entry = { terminal, fitAddon, ws, container, onDataDisposable, resizeObserver: null, removeTouchHandlers };
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

  return (
    <div className="flex flex-col overflow-hidden" style={{ height: '100%', background: 'hsl(var(--terminal-bg))' }}>
      <div ref={slotRef} className="flex-1 min-h-0 min-w-0" />
    </div>
  );
}
