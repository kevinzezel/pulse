'use client';

import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Settings, X, FileText, Sparkles, Bell, BellOff, Keyboard, Loader, Mic } from 'lucide-react';
import { useTranslation } from '@/providers/I18nProvider';
import { useNotifications } from '@/providers/NotificationsProvider';
import { isTerminalConnected, subscribeTerminalConnection } from './TerminalPane';

const STAGGER_MS = 35;
const TRANSITION_MS = 160;

export default function PaneActionsFab({
  sessionId,
  session,
  isOpen,
  onToggle,
  onCapture,
  onOpenPrompts,
  onToggleNotify,
  onRequestCompose,
  composeLoading,
  onRequestVoice,
}) {
  const { t } = useTranslation();
  const containerRef = useRef(null);
  const {
    supported: notifySupported,
    permission: notifyPermission,
    permissionReason: notifyPermissionReason,
    requestBrowserPermission,
  } = useNotifications();
  const [connected, setConnected] = useState(() => isTerminalConnected(sessionId));

  useEffect(() => {
    setConnected(isTerminalConnected(sessionId));
    return subscribeTerminalConnection(sessionId, setConnected);
  }, [sessionId]);

  // Se a conexão cai com o FAB aberto, recolher pra evitar disparar ação
  // numa sessão que não vai responder.
  useEffect(() => {
    if (isOpen && !connected) onToggle();
  }, [connected, isOpen, onToggle]);

  useEffect(() => {
    if (!isOpen) return;
    function handleKey(e) {
      if (e.key === 'Escape') onToggle();
    }
    function handleClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        onToggle();
      }
    }
    document.addEventListener('keydown', handleKey);
    document.addEventListener('mousedown', handleClick);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('mousedown', handleClick);
    };
  }, [isOpen, onToggle]);

  const notifyOn = !!session?.notify_on_idle;

  function closeAnd(action) {
    return (e) => {
      e.stopPropagation();
      onToggle();
      action();
    };
  }

  async function handleNotifyClick(e) {
    e.stopPropagation();
    onToggle();
    const willEnable = !notifyOn;
    onToggleNotify?.(sessionId, willEnable);
    if (!willEnable || !notifySupported) return;
    const deniedToast = () => {
      if (notifyPermissionReason === 'insecure-context') {
        toast.error(t('notifications.insecureContextToast', {
          origin: window.location.origin,
        }), { duration: 7000 });
      } else {
        toast.error(t('notifications.permissionDeniedToast'));
      }
    };
    if (notifyPermission === 'default') {
      const result = await requestBrowserPermission();
      if (result === 'granted') {
        toast.success(t('notifications.permissionGrantedToast'));
      } else if (result === 'denied') {
        deniedToast();
      }
    } else if (notifyPermission === 'denied') {
      deniedToast();
    }
  }

  const buttons = [
    {
      key: 'capture',
      icon: <FileText size={14} />,
      label: t('terminal.actions.captureShort'),
      onClick: closeAnd(() => onCapture?.(sessionId)),
    },
    {
      key: 'prompts',
      icon: <Sparkles size={14} />,
      label: t('terminal.actions.promptsShort'),
      onClick: closeAnd(() => onOpenPrompts?.(sessionId)),
    },
    {
      key: 'notify',
      icon: notifyOn ? <Bell size={14} /> : <BellOff size={14} />,
      label: t('terminal.actions.notifyShort'),
      onClick: handleNotifyClick,
      activeColor: notifyOn,
    },
    {
      key: 'keyboard',
      icon: composeLoading ? <Loader size={14} className="animate-spin" /> : <Keyboard size={14} />,
      label: t('terminal.actions.composeShort'),
      onClick: closeAnd(() => onRequestCompose?.(sessionId)),
      disabled: composeLoading,
    },
    {
      key: 'voice',
      icon: <Mic size={14} />,
      label: t('terminal.actions.voiceShort'),
      onClick: closeAnd(() => onRequestVoice?.(sessionId)),
    },
  ];

  const gearTitle = !connected
    ? t('terminal.actions.disconnected')
    : t('terminal.actions.menu');

  return (
    <div ref={containerRef} className="absolute top-2 right-4 z-10 flex flex-col items-end gap-1.5">
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (!connected) return;
          onToggle();
        }}
        disabled={!connected}
        title={gearTitle}
        aria-label={gearTitle}
        aria-disabled={!connected}
        className={`relative w-10 h-10 rounded-full inline-flex items-center justify-center border transition-all shadow-md disabled:cursor-not-allowed disabled:opacity-60 ${
          isOpen
            ? 'bg-primary text-primary-foreground border-primary'
            : 'border-border bg-muted text-foreground hover:bg-accent'
        }`}
        style={{
          transform: isOpen ? 'rotate(45deg)' : 'rotate(0)',
          transitionDuration: '200ms',
        }}
      >
        {isOpen ? <X size={17} strokeWidth={2.5} /> : <Settings size={17} strokeWidth={2.25} />}
      </button>

      <div
        className="flex flex-col items-end gap-1.5"
        style={{ pointerEvents: isOpen ? 'auto' : 'none' }}
      >
        {buttons.map((b, i) => {
          const delay = isOpen ? i * STAGGER_MS : (buttons.length - 1 - i) * STAGGER_MS;
          return (
            <button
              key={b.key}
              onClick={b.onClick}
              disabled={b.disabled}
              title={b.label}
              aria-label={b.label}
              className={`inline-flex items-center gap-1.5 px-2.5 h-7 rounded-md border bg-card shadow-sm text-xs font-medium transition-all disabled:opacity-50 disabled:pointer-events-none ${
                b.activeColor
                  ? 'text-primary border-primary/40'
                  : 'text-foreground hover:text-primary border-border'
              }`}
              style={{
                transform: isOpen ? 'translateY(0) scale(1)' : 'translateY(-8px) scale(0.85)',
                opacity: isOpen ? 1 : 0,
                transitionDuration: `${TRANSITION_MS}ms`,
                transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
                transitionDelay: `${delay}ms`,
              }}
            >
              {b.icon}
              <span>{b.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
