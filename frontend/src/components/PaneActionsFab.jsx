'use client';

import { useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import { Settings, X, FileText, MessageSquareText, Bell, BellOff, Keyboard, Loader } from 'lucide-react';
import { useTranslation } from '@/providers/I18nProvider';
import { useNotifications } from '@/providers/NotificationsProvider';

const RADIUS = 64;
const ANGLES_DEG = [180, 210, 240, 270];
const STAGGER_MS = 40;
const TRANSITION_MS = 180;

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
}) {
  const { t } = useTranslation();
  const containerRef = useRef(null);
  const {
    supported: notifySupported,
    permission: notifyPermission,
    permissionReason: notifyPermissionReason,
    requestBrowserPermission,
  } = useNotifications();

  useEffect(() => {
    if (!isOpen) return;
    function handleKey(e) {
      if (e.key === 'Escape') onToggle();
    }
    // Containment check (not stopPropagation) is what protects gear/satellite clicks from re-closing the FAB.
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

  const notifyOn = !!session.notify_on_idle;

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
      label: t('toolbar.capture'),
      onClick: closeAnd(() => onCapture?.(sessionId)),
    },
    {
      key: 'prompts',
      icon: <MessageSquareText size={14} />,
      label: t('toolbar.prompts'),
      onClick: closeAnd(() => onOpenPrompts?.(sessionId)),
    },
    {
      key: 'notify',
      icon: notifyOn ? <Bell size={14} /> : <BellOff size={14} />,
      label: notifyOn ? t('sidebar.notifyOn') : t('sidebar.notifyOff'),
      onClick: handleNotifyClick,
      activeColor: notifyOn,
    },
    {
      key: 'keyboard',
      icon: composeLoading ? <Loader size={14} className="animate-spin" /> : <Keyboard size={14} />,
      label: t('sidebar.compose'),
      onClick: closeAnd(() => onRequestCompose?.(sessionId)),
      disabled: composeLoading,
    },
  ];

  return (
    <div ref={containerRef} className="absolute top-2 right-4 z-10">
      {buttons.map((b, i) => {
        const rad = (ANGLES_DEG[i] * Math.PI) / 180;
        const x = RADIUS * Math.cos(rad);
        const y = -RADIUS * Math.sin(rad);
        const delay = isOpen ? i * STAGGER_MS : (buttons.length - 1 - i) * STAGGER_MS;
        return (
          <button
            key={b.key}
            onClick={b.onClick}
            disabled={b.disabled}
            title={b.label}
            aria-label={b.label}
            className={`group absolute w-8 h-8 rounded-full border bg-card shadow-md inline-flex items-center justify-center transition-all disabled:opacity-50 disabled:pointer-events-none ${
              b.activeColor ? 'text-primary border-primary/40' : 'text-muted-foreground hover:text-primary border-border'
            }`}
            style={{
              top: '4px',
              right: '4px',
              transform: isOpen
                ? `translate(${x}px, ${y}px) scale(1)`
                : 'translate(0, 0) scale(0)',
              opacity: isOpen ? 1 : 0,
              transitionDuration: `${TRANSITION_MS}ms`,
              transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
              transitionDelay: `${delay}ms`,
              pointerEvents: isOpen ? 'auto' : 'none',
            }}
          >
            {b.icon}
            <span
              className="absolute right-10 top-1/2 -translate-y-1/2 px-2 py-0.5 rounded text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
              style={{
                background: 'hsl(var(--foreground) / 0.85)',
                color: 'hsl(var(--background))',
              }}
            >
              {b.label}
            </span>
          </button>
        );
      })}

      <button
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        title={t('terminal.actions.menu')}
        aria-label={t('terminal.actions.menu')}
        className={`relative w-9 h-9 rounded-full inline-flex items-center justify-center border transition-all shadow-sm ${
          isOpen
            ? 'bg-primary text-primary-foreground border-primary'
            : 'border-primary/50 bg-primary/15 text-primary hover:bg-primary/25'
        }`}
        style={{
          transform: isOpen ? 'rotate(45deg)' : 'rotate(0)',
          transitionDuration: '200ms',
        }}
      >
        {isOpen ? <X size={16} strokeWidth={2.5} /> : <Settings size={16} strokeWidth={2.25} />}
      </button>
    </div>
  );
}
