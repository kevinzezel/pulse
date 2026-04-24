'use client';

import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { X } from 'lucide-react';
import { useTranslation, useErrorToast } from '@/providers/I18nProvider';
import { sendTextToSession } from '@/services/api';
import PromptsManager from './PromptsManager';

/**
 * Modal wrapper around `PromptsManager` in 'selector' mode. Picks a target
 * session (`sessionId`) from the opener, pushes the chosen prompt body via
 * `sendTextToSession`, shows a success toast, and closes. Escape + backdrop
 * click both close the modal.
 */
export default function PromptSelectorModal({ sessionId, open, onClose, currentProjectId = null }) {
  const { t } = useTranslation();
  const showError = useErrorToast();
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    function handleKey(e) {
      if (e.key === 'Escape' && !sending) onClose?.();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose, sending]);

  if (!open) return null;

  async function handleSend(prompt, sendEnter) {
    if (sending || !sessionId) return;
    setSending(true);
    try {
      await sendTextToSession(sessionId, prompt.body || '', sendEnter);
      toast.success(t('prompts.sentToTerminal'));
      onClose?.();
    } catch (err) {
      showError(err);
    } finally {
      setSending(false);
    }
  }

  function handleBackdropClick(e) {
    if (e.target === e.currentTarget && !sending) onClose?.();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/60 px-4 py-6"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-card border border-border rounded-lg p-5 sm:p-6 w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between mb-4 flex-shrink-0">
          <h3 className="text-foreground font-semibold">{t('prompts.selectorTitle')}</h3>
          <button
            onClick={() => !sending && onClose?.()}
            disabled={sending}
            className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto pr-1">
          <PromptsManager
            mode="selector"
            onSendPrompt={handleSend}
            currentProjectId={currentProjectId}
            sendingDisabled={sending}
          />
        </div>
      </div>
    </div>
  );
}
