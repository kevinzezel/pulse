'use client';

import { useState } from 'react';
import { Copy, Check, AlertTriangle } from 'lucide-react';
import { useTranslation } from '@/providers/I18nProvider';

export default function ShareBackendModal({ backendName, token, onClose }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API might fail in non-secure contexts; user can still
      // select-all manually via the focused textarea.
    }
  }

  return (
    <div className="fixed inset-0 bg-overlay/60 z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-lg p-6 w-full max-w-lg space-y-4">
        <h3 className="text-lg font-semibold">
          {t('settings.storage.shareModal.title', { name: backendName })}
        </h3>

        <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/30 rounded text-sm">
          <AlertTriangle className="size-5 text-destructive shrink-0 mt-0.5" />
          <p className="text-destructive">
            {t('settings.storage.shareModal.warning')}
          </p>
        </div>

        <div className="relative">
          <textarea
            readOnly
            value={token}
            rows={4}
            className="w-full px-3 py-2 pr-12 border border-input rounded bg-background font-mono text-xs break-all"
            onFocus={(e) => e.target.select()}
          />
          <button
            onClick={handleCopy}
            className="absolute top-2 right-2 p-2 rounded hover:bg-accent"
            aria-label={t('settings.storage.shareModal.copy')}
            title={copied ? t('settings.storage.shareModal.copied') : t('settings.storage.shareModal.copy')}
          >
            {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
          </button>
        </div>

        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="px-3 py-2 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {t('settings.storage.shareModal.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
