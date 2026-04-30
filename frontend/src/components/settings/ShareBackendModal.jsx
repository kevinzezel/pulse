'use client';

import { useState } from 'react';
import { Copy, Check, AlertTriangle, X } from 'lucide-react';
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/60 px-4">
      <div className="bg-card border border-border rounded-lg p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-foreground font-semibold">
            {t('settings.storage.shareModal.title', { name: backendName })}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            aria-label={t('settings.storage.shareModal.close')}
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/30 rounded-md text-sm mb-4">
          <AlertTriangle className="size-5 text-destructive shrink-0 mt-0.5" />
          <p className="text-destructive">
            {t('settings.storage.shareModal.warning')}
          </p>
        </div>

        <div className="relative mb-4">
          <textarea
            readOnly
            value={token}
            rows={4}
            className="w-full px-3 py-2 pr-12 bg-input border border-border rounded-md text-foreground font-mono text-xs break-all focus:outline-none focus:ring-1 focus:ring-ring"
            onFocus={(e) => e.target.select()}
          />
          <button
            type="button"
            onClick={handleCopy}
            className="absolute top-2 right-2 p-2 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
            aria-label={t('settings.storage.shareModal.copy')}
            title={copied ? t('settings.storage.shareModal.copied') : t('settings.storage.shareModal.copy')}
          >
            {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
          </button>
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="py-2 px-6 rounded-md text-sm font-medium text-white bg-brand-gradient hover:opacity-90 transition-opacity"
          >
            {t('settings.storage.shareModal.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
