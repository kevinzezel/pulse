'use client';

import { useEffect, useState } from 'react';
import { X, Copy, Check, ExternalLink } from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from '@/providers/I18nProvider';

const UPGRADE_COMMAND = 'pulse upgrade';
const RELEASE_NOTES_BASE = 'https://github.com/kevinzezel/pulse/releases/tag/v';

export default function UpdateAvailableModal({ latestVersion, outdatedServers, onDismiss }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    function handleKey(e) { if (e.key === 'Escape') onDismiss(); }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onDismiss]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(UPGRADE_COMMAND);
      setCopied(true);
      toast.success(t('update.modal.copiedToast'));
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(t('toast.unexpectedError'));
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/60 px-4">
      <div className="bg-card border border-border rounded-lg p-6 w-full max-w-lg">
        <div className="flex items-start justify-between mb-4 gap-4">
          <div>
            <h3 className="text-foreground font-semibold text-base">
              {t('update.modal.title', { version: latestVersion })}
            </h3>
            <p className="text-muted-foreground text-sm mt-1">
              {t('update.modal.subtitle', { count: outdatedServers.length })}
            </p>
          </div>
          <button
            onClick={onDismiss}
            aria-label={t('update.modal.closeAria')}
            className="text-muted-foreground hover:text-foreground"
          >
            <X size={18} />
          </button>
        </div>

        <ul className="mb-4 space-y-2">
          {outdatedServers.map((s) => (
            <li
              key={s.id}
              className="flex items-center gap-3 text-sm bg-muted/40 border border-border rounded-md px-3 py-2"
            >
              <span
                className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                style={{ background: s.color || 'hsl(var(--muted-foreground))' }}
              />
              <span className="font-medium text-foreground truncate flex-1">{s.name}</span>
              <span className="text-muted-foreground text-xs whitespace-nowrap">
                {s.currentVersion ? (
                  <>
                    <span>{s.currentVersion}</span>
                    <span className="mx-1.5">→</span>
                    <span className="text-success font-medium">{latestVersion}</span>
                  </>
                ) : (
                  <span className="italic">{t('update.modal.unknownVersion')}</span>
                )}
              </span>
            </li>
          ))}
        </ul>

        <p className="text-sm text-muted-foreground mb-2">
          {t('update.modal.instructions')}
        </p>

        <div className="flex items-stretch gap-2 mb-5">
          <pre className="flex-1 bg-muted border border-border rounded-md px-3 py-2 text-foreground text-sm font-mono overflow-x-auto">
{UPGRADE_COMMAND}
          </pre>
          <button
            onClick={handleCopy}
            className="px-3 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors inline-flex items-center gap-1.5 text-sm"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {t('update.modal.copyButton')}
          </button>
        </div>

        <div className="flex gap-2">
          <a
            href={`${RELEASE_NOTES_BASE}${latestVersion}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 py-2 rounded-md text-sm font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors inline-flex items-center justify-center gap-1.5"
          >
            <ExternalLink size={14} />
            {t('update.modal.releaseNotesButton')}
          </a>
          <button
            type="button"
            onClick={onDismiss}
            className="flex-1 py-2 rounded-md text-sm font-medium text-white bg-brand-gradient hover:opacity-90 transition-opacity"
          >
            {t('update.modal.dismissButton')}
          </button>
        </div>
      </div>
    </div>
  );
}
