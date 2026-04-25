'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Trash2, Paperclip, FileIcon, Loader, Send, CornerDownLeft, Terminal } from 'lucide-react';
import toast from 'react-hot-toast';
import { saveFileToTemp, sendTextToSession, splitSessionId } from '@/services/api';
import { useTranslation, useErrorToast } from '@/providers/I18nProvider';
import { getAllServers } from '@/providers/ServersProvider';
import ServerTag from './ServerTag';

const MAX_ITEMS = 15;

function isImageFile(file) {
  return !!(file && file.type && file.type.startsWith('image/'));
}

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ClipboardGallery({ sessions = [] }) {
  const { t, formatTime } = useTranslation();
  const showError = useErrorToast();
  const [items, setItems] = useState([]);
  const [previewItem, setPreviewItem] = useState(null);
  const [sendingItem, setSendingItem] = useState(null);
  const [sendingAll, setSendingAll] = useState(false);
  const [sendingKey, setSendingKey] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

  const addFiles = useCallback((files) => {
    const valid = files.filter(Boolean);
    if (valid.length === 0) return;
    setItems(prev => {
      const slotsLeft = MAX_ITEMS - prev.length;
      if (slotsLeft <= 0) {
        toast.error(t('clipboard.limitReached', { max: MAX_ITEMS }));
        return prev;
      }
      const accepted = valid.slice(0, slotsLeft);
      if (accepted.length < valid.length) {
        toast.error(t('clipboard.limitReached', { max: MAX_ITEMS }));
      }
      const entries = accepted.map((blob, idx) => {
        const isImg = isImageFile(blob);
        return {
          id: `${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 7)}`,
          // Só geramos URL pra preview de imagem; pra outros arquivos não gasta
          // memória do browser à toa.
          url: isImg ? URL.createObjectURL(blob) : null,
          blob,
          name: blob.name || (isImg ? 'image' : 'file'),
          size: blob.size || 0,
          isImage: isImg,
          timestamp: new Date(),
        };
      });
      return [...entries, ...prev];
    });
  }, [t]);

  const handlePaste = useCallback((e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const blobs = [];
    for (const i of items) {
      if (i.kind === 'file') {
        const f = i.getAsFile();
        if (f) blobs.push(f);
      }
    }
    if (blobs.length === 0) return;
    e.preventDefault();
    addFiles(blobs);
  }, [addFiles]);

  function handleDragEnter(e) {
    if (!Array.from(e.dataTransfer?.types || []).includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    setIsDragging(true);
  }

  function handleDragOver(e) {
    if (!Array.from(e.dataTransfer?.types || []).includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  }

  function handleDragLeave(e) {
    if (!Array.from(e.dataTransfer?.types || []).includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) setIsDragging(false);
  }

  function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setIsDragging(false);
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length === 0) return;
    addFiles(files);
  }

  useEffect(() => {
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [handlePaste]);

  async function ensurePathFor(item, serverId) {
    if (!serverId) throw new Error('no server');
    if (!item._tempPaths) item._tempPaths = {};
    if (item._tempPaths[serverId]) return item._tempPaths[serverId];
    const path = await saveFileToTemp(serverId, item.blob, item.name);
    item._tempPaths[serverId] = path;
    return path;
  }

  async function handleSend(sessionId, sendEnter) {
    if (!sendingItem) return;
    const key = `${sessionId}:${sendEnter ? '1' : '0'}`;
    const { serverId } = splitSessionId(sessionId);
    setSendingKey(key);
    try {
      const path = await ensurePathFor(sendingItem, serverId);
      const data = await sendTextToSession(sessionId, `@${path}`, sendEnter);
      toast.success(data.detail);
      setSendingItem(null);
    } catch (err) {
      showError(err);
    } finally {
      setSendingKey(null);
    }
  }

  function openSendFor(e, item) {
    e.stopPropagation();
    setSendingItem(item);
  }

  async function handleSendAll(sessionId, sendEnter) {
    if (items.length === 0) return;
    const key = `${sessionId}:${sendEnter ? '1' : '0'}`;
    const { serverId } = splitSessionId(sessionId);
    setSendingKey(key);
    try {
      const paths = await Promise.all(items.map(item => ensurePathFor(item, serverId)));
      const text = paths.map(p => `@${p}`).join(' ');
      const data = await sendTextToSession(sessionId, text, sendEnter);
      toast.success(data.detail);
      setSendingAll(false);
    } catch (err) {
      showError(err);
    } finally {
      setSendingKey(null);
    }
  }

  function handleDelete(e, id) {
    e.stopPropagation();
    setItems(prev => {
      const item = prev.find(i => i.id === id);
      if (item?.url) URL.revokeObjectURL(item.url);
      return prev.filter(i => i.id !== id);
    });
    if (previewItem?.id === id) setPreviewItem(null);
    if (sendingItem?.id === id) setSendingItem(null);
  }

  function handleClearAll() {
    items.forEach(item => { if (item.url) URL.revokeObjectURL(item.url); });
    setItems([]);
  }

  function SendToTerminalButton({ item, size = 12, className = '' }) {
    return (
      <button
        onClick={(e) => openSendFor(e, item)}
        className={`flex items-center justify-center transition-colors ${className}`}
        title={t('clipboard.sendToTerminal')}
      >
        <Send size={size} />
      </button>
    );
  }

  function ItemThumb({ item }) {
    if (item.isImage && item.url) {
      return <img src={item.url} alt="" className="w-full h-full object-cover" />;
    }
    return (
      <div className="flex flex-col items-center justify-center h-full w-full p-1 text-muted-foreground bg-muted/30">
        <FileIcon size={20} />
        <span className="mt-0.5 text-[8px] text-center truncate w-full px-1" title={item.name}>
          {item.name}
        </span>
      </div>
    );
  }

  return (
    <>
      <div
        className={`px-2 pb-2 relative transition-colors ${
          isDragging ? 'bg-primary/10 ring-1 ring-primary/60 ring-inset' : ''
        }`}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isDragging && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
            <p className="text-xs font-medium text-primary bg-card/90 px-2 py-1 rounded border border-primary/40">
              {t('clipboard.dropHint')}
            </p>
          </div>
        )}
        <div className="flex items-center justify-between px-2 py-1">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {t('clipboard.title')}
          </p>
          {items.length > 0 && (
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => setSendingAll(true)}
                className="p-0.5 text-muted-foreground hover:text-foreground transition-colors"
                title={t('clipboard.sendAll')}
                aria-label={t('clipboard.sendAll')}
              >
                <Send size={10} />
              </button>
              <button
                onClick={handleClearAll}
                className="p-0.5 text-muted-foreground hover:text-destructive transition-colors"
                title={t('clipboard.clearAll')}
                aria-label={t('clipboard.clearAll')}
              >
                <Trash2 size={10} />
              </button>
            </div>
          )}
        </div>

        {items.length > 0 ? (
          <div className="grid grid-cols-3 gap-1 max-h-48 overflow-y-auto">
            {items.map(item => (
              <div
                key={item.id}
                className="relative aspect-video rounded overflow-hidden border border-border hover:border-primary/60 transition-colors group cursor-pointer"
                onClick={() => setPreviewItem(item)}
              >
                <ItemThumb item={item} />
                <div className="absolute inset-0 bg-overlay/0 group-hover:bg-overlay/40 transition-colors" />
                <div className="absolute top-0.5 right-0.5 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <SendToTerminalButton
                    item={item}
                    size={10}
                    className="p-0.5 rounded bg-overlay/60 text-white hover:bg-primary/80"
                  />
                  <button
                    onClick={(e) => handleDelete(e, item.id)}
                    className="p-0.5 rounded bg-overlay/60 text-white hover:bg-destructive/80 transition-colors"
                    title={t('clipboard.delete')}
                  >
                    <X size={10} />
                  </button>
                </div>
                <div className="absolute bottom-0 left-0 right-0 bg-overlay/60 text-[8px] text-center text-white py-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  {formatTime(item.timestamp)}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-3 gap-1 text-muted-foreground">
            <Paperclip size={16} className="opacity-30" />
            <p className="text-[10px] opacity-50">{t('clipboard.captureHint')}</p>
          </div>
        )}
      </div>

      {previewItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/70" onClick={() => setPreviewItem(null)}>
          <div className="relative max-w-[90vw] max-h-[90vh] bg-card border border-border rounded-lg overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-3 py-2 border-b border-border">
              <span className="text-xs text-muted-foreground truncate max-w-[60vw]" title={previewItem.name}>
                {previewItem.name} · {formatBytes(previewItem.size)} · {formatTime(previewItem.timestamp)}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={(e) => openSendFor(e, previewItem)}
                  className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-primary/20 text-primary hover:bg-primary/30 transition-colors"
                >
                  <Send size={12} />
                  {t('clipboard.sendToTerminal')}
                </button>
                <button
                  onClick={(e) => handleDelete(e, previewItem.id)}
                  className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                  title={t('clipboard.delete')}
                >
                  <Trash2 size={14} />
                </button>
                <button
                  onClick={() => setPreviewItem(null)}
                  className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
            <div className="p-2 flex items-center justify-center" style={{ maxHeight: 'calc(90vh - 44px)' }}>
              {previewItem.isImage && previewItem.url ? (
                <img
                  src={previewItem.url}
                  alt=""
                  className="max-w-full max-h-[calc(90vh-60px)] object-contain rounded"
                />
              ) : (
                <div className="flex flex-col items-center justify-center gap-2 px-8 py-12 text-muted-foreground">
                  <FileIcon size={48} />
                  <span className="text-sm font-medium text-foreground">{previewItem.name}</span>
                  <span className="text-xs">{formatBytes(previewItem.size)}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {sendingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/60 px-4 py-6" onClick={() => setSendingItem(null)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-card border border-border rounded-lg p-5 w-full max-w-md flex flex-col gap-3 max-h-full overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-foreground font-semibold">{t('clipboard.sendTitle')}</h3>
              <button
                onClick={() => setSendingItem(null)}
                disabled={sendingKey !== null}
                className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                <X size={16} />
              </button>
            </div>
            <p className="text-xs text-muted-foreground">{t('clipboard.sendSubtitle')}</p>
            {sessions.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                {t('clipboard.noSessions')}
              </div>
            ) : (
              <ul className="space-y-2">
                {sessions.map(s => (
                  <li key={s.id} className="flex items-center gap-2 p-2 rounded-md border border-border">
                    <Terminal size={14} className="text-muted-foreground flex-shrink-0" />
                    <span className="flex-1 min-w-0 truncate text-sm text-foreground">{s.name}</span>
                    {s.server_name && getAllServers().length > 1 && (
                      <ServerTag name={s.server_name} color={s.server_color} />
                    )}
                    <button
                      onClick={() => handleSend(s.id, false)}
                      disabled={sendingKey !== null}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-50"
                    >
                      {sendingKey === `${s.id}:0` ? <Loader size={12} className="animate-spin" /> : <Send size={12} />}
                      {t('clipboard.sendOnly')}
                    </button>
                    <button
                      onClick={() => handleSend(s.id, true)}
                      disabled={sendingKey !== null}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-white bg-brand-gradient hover:opacity-90 disabled:opacity-50"
                    >
                      {sendingKey === `${s.id}:1` ? <Loader size={12} className="animate-spin" /> : <CornerDownLeft size={12} />}
                      {t('clipboard.sendEnter')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {sendingAll && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/60 px-4 py-6" onClick={() => setSendingAll(false)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-card border border-border rounded-lg p-5 w-full max-w-md flex flex-col gap-3 max-h-full overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-foreground font-semibold">{t('clipboard.sendTitle')} ({items.length})</h3>
              <button
                onClick={() => setSendingAll(false)}
                disabled={sendingKey !== null}
                className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                <X size={16} />
              </button>
            </div>
            <p className="text-xs text-muted-foreground">{t('clipboard.sendSubtitle')}</p>
            {sessions.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                {t('clipboard.noSessions')}
              </div>
            ) : (
              <ul className="space-y-2">
                {sessions.map(s => (
                  <li key={s.id} className="flex items-center gap-2 p-2 rounded-md border border-border">
                    <Terminal size={14} className="text-muted-foreground flex-shrink-0" />
                    <span className="flex-1 min-w-0 truncate text-sm text-foreground">{s.name}</span>
                    {s.server_name && getAllServers().length > 1 && (
                      <ServerTag name={s.server_name} color={s.server_color} />
                    )}
                    <button
                      onClick={() => handleSendAll(s.id, false)}
                      disabled={sendingKey !== null}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-50"
                    >
                      {sendingKey === `${s.id}:0` ? <Loader size={12} className="animate-spin" /> : <Send size={12} />}
                      {t('clipboard.sendOnly')}
                    </button>
                    <button
                      onClick={() => handleSendAll(s.id, true)}
                      disabled={sendingKey !== null}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-white bg-brand-gradient hover:opacity-90 disabled:opacity-50"
                    >
                      {sendingKey === `${s.id}:1` ? <Loader size={12} className="animate-spin" /> : <CornerDownLeft size={12} />}
                      {t('clipboard.sendEnter')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </>
  );
}
