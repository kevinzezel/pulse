'use client';

import { useState, useRef, useEffect } from 'react';
import { X, Send, CornerDownLeft, Save, Check, Loader } from 'lucide-react';
import { useTranslation } from '@/providers/I18nProvider';
import { useIsMobile, useVisualViewportHeight } from '@/hooks/layout';

// Espelha SEND_TEXT_MAX_LENGTH em client/src/routes/terminal.py:37 — o backend
// rejeita payloads acima desse limite com 422, então cortamos no input pra que
// o usuário veja o limite antes do submit em vez de receber um erro genérico.
const SEND_TEXT_MAX_LENGTH = 50000;

export default function ComposeModal({
  initialValue = '',
  onSend,
  onSaveAsPrompt,
  onClose,
  sessionName,
  sessionCompositeId,
  onDraftPersist,
}) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const vvHeight = useVisualViewportHeight();

  const [text, setText] = useState(initialValue);
  const [savingAs, setSavingAs] = useState(false);
  const [promptName, setPromptName] = useState('');
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [sending, setSending] = useState(false);

  const taRef = useRef(null);
  const textRef = useRef(initialValue);
  const debounceRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.focus();
    const len = ta.value.length;
    ta.setSelectionRange(len, len);
  }, []);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta || !isMobile) return;
    ta.scrollTop = ta.scrollHeight;
  }, [vvHeight, isMobile]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
        if (sessionCompositeId && onDraftPersist) {
          onDraftPersist(sessionCompositeId, textRef.current);
        }
      }
    };
  }, [sessionCompositeId, onDraftPersist]);

  async function submit(sendEnter) {
    if (sending) return;
    // Load-bearing order: clear the pending debounce before a successful send
    // can unmount this modal, otherwise cleanup may re-persist stale text after
    // the parent already cleared the draft. On failure we persist explicitly.
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    setSending(true);
    let sent = false;
    try {
      sent = await onSend(text, sendEnter) === true;
    } finally {
      if (!sent && sessionCompositeId && onDraftPersist) {
        onDraftPersist(sessionCompositeId, textRef.current);
      }
      if (mountedRef.current) setSending(false);
    }
  }

  function startSaveAs() {
    setPromptName('');
    setSavingAs(true);
  }

  function cancelSaveAs() {
    setSavingAs(false);
    setPromptName('');
  }

  async function confirmSaveAs() {
    const name = promptName.trim();
    if (!name || !onSaveAsPrompt) return;
    setSavingPrompt(true);
    try {
      await onSaveAsPrompt({ name, body: text });
      setSavingAs(false);
      setPromptName('');
    } finally {
      setSavingPrompt(false);
    }
  }

  const titleLabel = sessionName ? `${t('compose.title')} — ${sessionName}` : t('compose.title');
  const overLimit = text.length > SEND_TEXT_MAX_LENGTH;
  const showCharCount = text.length >= SEND_TEXT_MAX_LENGTH * 0.9;

  const footer = savingAs ? (
    <div className="flex items-center gap-2">
      <input
        type="text"
        value={promptName}
        onChange={(e) => setPromptName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); confirmSaveAs(); }
          if (e.key === 'Escape') cancelSaveAs();
        }}
        placeholder={t('compose.promptName')}
        autoFocus
        maxLength={80}
        disabled={savingPrompt}
        className="flex-1 min-w-0 px-3 py-2 rounded-md bg-input border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <button
        onClick={confirmSaveAs}
        disabled={savingPrompt || !promptName.trim()}
        className="p-2 rounded-md text-success hover:bg-muted/40 transition-colors disabled:opacity-50"
        title={t('compose.saveAsConfirm')}
      >
        {savingPrompt ? <Loader size={16} className="animate-spin" /> : <Check size={16} />}
      </button>
      <button
        onClick={cancelSaveAs}
        disabled={savingPrompt}
        className="p-2 rounded-md text-muted-foreground hover:bg-muted/40 transition-colors disabled:opacity-50"
        title={t('common.cancel')}
      >
        <X size={16} />
      </button>
    </div>
  ) : (
    <div className="flex gap-2">
      {onSaveAsPrompt && (
        <button
          onClick={startSaveAs}
          disabled={!text.trim() || sending}
          className="inline-flex items-center justify-center px-3 py-2.5 rounded-md text-sm font-medium border border-border text-foreground hover:bg-muted/40 transition-colors disabled:opacity-50 flex-shrink-0"
          title={t('compose.saveAs')}
          aria-label={t('compose.saveAs')}
        >
          <Save size={14} />
        </button>
      )}
      <button
        onClick={() => submit(false)}
        disabled={sending || overLimit}
        className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 rounded-md text-sm font-medium border border-border text-foreground hover:bg-muted/40 transition-colors disabled:opacity-60"
      >
        {sending ? <Loader size={14} className="animate-spin" /> : <Send size={14} />}
        {t('compose.sendOnly')}
      </button>
      <button
        onClick={() => submit(true)}
        disabled={sending || overLimit}
        className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 rounded-md text-sm font-medium text-white bg-brand-gradient hover:opacity-90 transition-opacity disabled:opacity-60"
      >
        {sending ? <Loader size={14} className="animate-spin" /> : <CornerDownLeft size={14} />}
        {t('compose.sendEnter')}
      </button>
    </div>
  );

  const body = (
    <>
      <header
        className="relative flex items-center justify-center px-3 py-2 border-b flex-shrink-0"
        style={{ borderColor: 'hsl(var(--border))' }}
      >
        <span className="text-sm font-medium text-foreground truncate">{titleLabel}</span>
        {showCharCount && (
          <span
            className={`absolute left-2 top-1/2 -translate-y-1/2 text-xs ${overLimit ? 'text-destructive' : 'text-muted-foreground'}`}
            aria-live="polite"
          >
            {t('compose.charCount', { length: text.length, max: SEND_TEXT_MAX_LENGTH })}
          </span>
        )}
        {onClose && (
          <button
            onClick={onClose}
            disabled={sending}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title={t('common.cancel')}
            aria-label={t('common.cancel')}
          >
            <X size={16} />
          </button>
        )}
      </header>

      {isMobile && (
        <div
          className="px-3 py-2 border-b flex-shrink-0"
          style={{ borderColor: 'hsl(var(--border))' }}
        >
          {footer}
        </div>
      )}

      <textarea
        ref={taRef}
        value={text}
        maxLength={SEND_TEXT_MAX_LENGTH}
        onChange={(e) => {
          const v = e.target.value;
          setText(v);
          textRef.current = v;
          if (!sessionCompositeId || !onDraftPersist) return;
          if (debounceRef.current) clearTimeout(debounceRef.current);
          debounceRef.current = setTimeout(() => {
            debounceRef.current = null;
            onDraftPersist(sessionCompositeId, textRef.current);
          }, 500);
        }}
        className="flex-1 p-4 resize-none bg-transparent outline-none font-mono text-sm text-foreground placeholder:text-muted-foreground"
        placeholder={t('compose.placeholder')}
      />

      {!isMobile && (
        <div
          className="px-3 py-2 border-t flex-shrink-0"
          style={{ borderColor: 'hsl(var(--border))' }}
        >
          {footer}
        </div>
      )}
    </>
  );

  if (isMobile) {
    return (
      <div
        className="fixed inset-x-0 top-0 z-50 flex flex-col"
        style={{
          height: vvHeight ? `${vvHeight}px` : '100dvh',
          background: 'hsl(var(--background))',
        }}
      >
        {body}
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/60 px-4 py-2"
    >
      <div
        className="bg-card border border-border rounded-lg w-full max-w-3xl flex flex-col h-[calc(100vh-1rem)] overflow-hidden"
      >
        {body}
      </div>
    </div>
  );
}
