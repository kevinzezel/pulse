'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { X, ExternalLink, BellOff, Pencil, RotateCw } from 'lucide-react';
import { useTranslation } from '@/providers/I18nProvider';
import { isMixedContent } from '@/utils/serverHealth';
import { readSilencedIds, addSilencedId } from '@/utils/tlsSilenced';

const DISMISSED_KEY = 'rt:tlsModalDismissed';

function readDismissed() {
  if (typeof window === 'undefined') return false;
  try {
    return sessionStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeDismissed(value) {
  if (typeof window === 'undefined') return;
  try {
    if (value) sessionStorage.setItem(DISMISSED_KEY, '1');
    else sessionStorage.removeItem(DISMISSED_KEY);
  } catch {}
}

function colorStyle(server) {
  if (server?.color) return { background: `hsl(${server.color})` };
  return { background: 'hsl(var(--muted-foreground))' };
}

export default function TlsAcceptModal({ servers, offlineServerIds, onRetest }) {
  const { t } = useTranslation();
  const router = useRouter();

  const [silencedIds, setSilencedIds] = useState([]);
  const [sessionDismissed, setSessionDismissed] = useState(true);
  const [hydrated, setHydrated] = useState(false);
  const [retesting, setRetesting] = useState(false);

  useEffect(() => {
    setSilencedIds(readSilencedIds());
    setSessionDismissed(readDismissed());
    setHydrated(true);
  }, []);

  const offlineSet = useMemo(() => new Set(offlineServerIds || []), [offlineServerIds]);
  const silencedSet = useMemo(() => new Set(silencedIds), [silencedIds]);

  const tlsBlocked = useMemo(() => {
    if (!hydrated) return [];
    return (servers || []).filter(
      (s) => s.protocol === 'https' && offlineSet.has(s.id) && !silencedSet.has(s.id),
    );
  }, [hydrated, servers, offlineSet, silencedSet]);

  const mixedContent = useMemo(() => {
    if (!hydrated) return [];
    return (servers || []).filter(
      (s) => isMixedContent(s) && offlineSet.has(s.id) && !silencedSet.has(s.id),
    );
  }, [hydrated, servers, offlineSet, silencedSet]);

  const totalIssues = tlsBlocked.length + mixedContent.length;
  const visible = hydrated && totalIssues > 0 && !sessionDismissed;

  const handleSilence = useCallback(
    (server) => {
      const next = addSilencedId(server.id);
      setSilencedIds(next);
      toast.success(t('tls.acceptModal.silencedToast'));
    },
    [t],
  );

  const handleDismiss = useCallback(() => {
    writeDismissed(true);
    setSessionDismissed(true);
  }, []);

  const handleRetest = useCallback(async () => {
    if (retesting) return;
    setRetesting(true);
    try {
      await onRetest?.();
    } finally {
      setRetesting(false);
    }
  }, [onRetest, retesting]);

  const handleEdit = useCallback(
    (server) => {
      router.push(`/settings?tab=servers&edit=${encodeURIComponent(server.id)}`);
    },
    [router],
  );

  useEffect(() => {
    if (!visible) return;
    function handleKey(e) {
      if (e.key === 'Escape') handleDismiss();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [visible, handleDismiss]);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/60 px-4">
      <div className="bg-card border border-border rounded-lg p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-4 gap-4">
          <div>
            <h3 className="text-foreground font-semibold text-base">
              {t('tls.acceptModal.title')}
            </h3>
            <p className="text-muted-foreground text-sm mt-1">
              {t('tls.acceptModal.subtitle', { count: totalIssues })}
            </p>
          </div>
          <button
            onClick={handleDismiss}
            aria-label={t('tls.acceptModal.closeAria')}
            className="text-muted-foreground hover:text-foreground"
          >
            <X size={18} />
          </button>
        </div>

        {tlsBlocked.length > 0 && (
          <div className="mb-4">
            <h4 className="text-foreground font-medium text-sm mb-1">
              {t('tls.acceptModal.tlsSection.title')}
            </h4>
            <p className="text-muted-foreground text-xs mb-3">
              {t('tls.acceptModal.tlsSection.intro')}
            </p>
            <ul className="space-y-2">
              {tlsBlocked.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center gap-3 text-sm bg-muted/40 border border-border rounded-md px-3 py-2"
                >
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                    style={colorStyle(s)}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-foreground truncate">{s.name}</div>
                    <div className="text-muted-foreground text-xs truncate">
                      {`https://${s.host}:${s.port}`}
                    </div>
                  </div>
                  <a
                    href={`https://${s.host}:${s.port}/health`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-2.5 py-1.5 rounded-md border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors inline-flex items-center gap-1.5 shrink-0"
                  >
                    <ExternalLink size={13} />
                    {t('tls.acceptModal.openHealth')}
                  </a>
                  <button
                    type="button"
                    onClick={() => handleSilence(s)}
                    title={t('tls.acceptModal.silence')}
                    aria-label={t('tls.acceptModal.silence')}
                    className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors shrink-0"
                  >
                    <BellOff size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {mixedContent.length > 0 && (
          <div className="mb-4">
            <h4 className="text-foreground font-medium text-sm mb-1">
              {t('tls.acceptModal.mixedSection.title')}
            </h4>
            <p className="text-muted-foreground text-xs mb-3">
              {t('tls.acceptModal.mixedSection.intro')}
            </p>
            <ul className="space-y-2">
              {mixedContent.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center gap-3 text-sm bg-muted/40 border border-border rounded-md px-3 py-2"
                >
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                    style={colorStyle(s)}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-foreground truncate">{s.name}</div>
                    <div className="text-muted-foreground text-xs truncate">
                      {`http://${s.host}:${s.port}`}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleEdit(s)}
                    className="px-2.5 py-1.5 rounded-md border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors inline-flex items-center gap-1.5 shrink-0"
                  >
                    <Pencil size={13} />
                    {t('tls.acceptModal.editServer')}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSilence(s)}
                    title={t('tls.acceptModal.silence')}
                    aria-label={t('tls.acceptModal.silence')}
                    className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors shrink-0"
                  >
                    <BellOff size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleRetest}
            disabled={retesting}
            className="flex-1 py-2 rounded-md text-sm font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors inline-flex items-center justify-center gap-1.5 disabled:opacity-60"
          >
            <RotateCw size={14} className={retesting ? 'animate-spin' : ''} />
            {t('tls.acceptModal.retest')}
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            className="flex-1 py-2 rounded-md text-sm font-medium text-white bg-brand-gradient hover:opacity-90 transition-opacity"
          >
            {t('tls.acceptModal.dismiss')}
          </button>
        </div>
      </div>
    </div>
  );
}
