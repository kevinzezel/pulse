'use client';

import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { X, Copy, Check, Loader, Search, Download } from 'lucide-react';
import { captureSession } from '@/services/api';
import { useTranslation, useErrorToast } from '@/providers/I18nProvider';

const LINE_PRESETS = [100, 500, 2000, 10000];

export default function TerminalCaptureModal({ sessionId, sessionName, onClose }) {
  const { t } = useTranslation();
  const showError = useErrorToast();
  const textareaRef = useRef(null);

  const [lines, setLines] = useState(500);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [query, setQuery] = useState('');

  // Load capture whenever `lines` changes or on mount.
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    setLoading(true);
    captureSession(sessionId, lines)
      .then(data => {
        if (cancelled) return;
        setText(data.text || '');
      })
      .catch(err => { if (!cancelled) showError(err); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [sessionId, lines, showError]);

  // Select all on first paint so Cmd/Ctrl+C just works.
  useEffect(() => {
    if (!loading && textareaRef.current && text) {
      // Don't auto-select — it scrolls to the top and users often want the bottom.
      textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
    }
  }, [loading, text]);

  async function handleCopyAll() {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success(t('capture.copied', { count: text.length }));
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      // Fallback: select all in the textarea so user can Ctrl+C
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.select();
      }
      toast.error(t('capture.copyFailed'));
    }
  }

  function handleDownload() {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.href = url;
    a.download = `${sessionName || sessionId}-${stamp}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function handleBackdropClick(e) {
    if (e.target === e.currentTarget) onClose?.();
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') onClose?.();
  }

  // Client-side filter: highlighting matches is expensive in a textarea, so
  // we just show lines that match. Query empty → show all.
  const displayedText = query
    ? text
        .split('\n')
        .filter(line => line.toLowerCase().includes(query.toLowerCase()))
        .join('\n')
    : text;

  return (
    <div
      className="fixed inset-0 z-50 bg-overlay/60 backdrop-blur-sm flex items-center justify-center p-0 sm:p-6"
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full h-full sm:h-[88vh] sm:max-w-5xl bg-card sm:rounded-lg border-0 sm:border border-border shadow-xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b" style={{ borderColor: 'hsl(var(--border))' }}>
          <div className="flex flex-col min-w-0">
            <h2 className="text-sm font-semibold text-foreground truncate">
              {t('capture.title')}
            </h2>
            <p className="text-xs text-muted-foreground truncate">
              {sessionName || sessionId}
            </p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
            aria-label={t('common.cancel')}
          >
            <X size={16} />
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 px-4 py-2 border-b" style={{ borderColor: 'hsl(var(--border))' }}>
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground mr-1">{t('capture.linesLabel')}</span>
            {LINE_PRESETS.map(n => (
              <button
                key={n}
                onClick={() => setLines(n)}
                disabled={loading}
                className={`px-2 py-1 text-xs rounded-md border transition-colors disabled:opacity-50 ${
                  lines === n
                    ? 'border-primary text-primary bg-primary/10'
                    : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted/40'
                }`}
              >
                {n >= 1000 ? `${n / 1000}k` : n}
              </button>
            ))}
          </div>
          <div className="flex-1 flex items-center gap-1 min-w-0">
            <Search size={12} className="text-muted-foreground shrink-0" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('capture.filterPlaceholder')}
              className="flex-1 min-w-0 px-2 py-1 rounded-md bg-input border border-border text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="flex items-center gap-1 justify-end">
            <button
              onClick={handleDownload}
              disabled={loading || !text}
              title={t('capture.download')}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-50"
            >
              <Download size={12} />
              <span className="hidden sm:inline">{t('capture.download')}</span>
            </button>
            <button
              onClick={handleCopyAll}
              disabled={loading || !text}
              className="inline-flex items-center gap-1 px-3 py-1 text-xs rounded-md text-white bg-brand-gradient hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? t('capture.copied_short') : t('capture.copyAll')}
            </button>
          </div>
        </div>

        {/* Textarea */}
        <div className="flex-1 min-h-0 p-2 sm:p-3">
          {loading ? (
            <div className="h-full flex items-center justify-center">
              <Loader className="w-5 h-5 text-muted-foreground animate-spin" />
            </div>
          ) : (
            <textarea
              ref={textareaRef}
              value={displayedText}
              readOnly
              spellCheck={false}
              wrap="off"
              className="w-full h-full resize-none bg-terminal text-sm font-mono text-foreground p-3 rounded-md border border-border focus:outline-none focus:ring-2 focus:ring-ring"
              style={{
                fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
                lineHeight: 1.4,
                whiteSpace: 'pre',
                overflowX: 'auto',
              }}
            />
          )}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2 border-t text-[11px] text-muted-foreground" style={{ borderColor: 'hsl(var(--border))' }}>
          {t('capture.hint')}
        </div>
      </div>
    </div>
  );
}
