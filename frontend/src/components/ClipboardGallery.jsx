'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Trash2, Image, Loader, Send, CornerDownLeft, Terminal } from 'lucide-react';
import toast from 'react-hot-toast';
import { saveImageToTemp, sendTextToSession, splitSessionId } from '@/services/api';
import { useTranslation, useErrorToast } from '@/providers/I18nProvider';
import { getAllServers } from '@/providers/ServersProvider';
import ServerTag from './ServerTag';

export default function ClipboardGallery({ sessions = [] }) {
  const { t, formatTime } = useTranslation();
  const showError = useErrorToast();
  const [images, setImages] = useState([]);
  const [previewImage, setPreviewImage] = useState(null);
  const [sendingImg, setSendingImg] = useState(null);
  const [sendingAll, setSendingAll] = useState(false);
  const [sendingKey, setSendingKey] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

  const MAX_IMAGES = 15;

  const addImages = useCallback((files) => {
    const imageFiles = files.filter(f => f && f.type && f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;
    setImages(prev => {
      const slotsLeft = MAX_IMAGES - prev.length;
      if (slotsLeft <= 0) {
        toast.error(t('clipboard.limitReached', { max: MAX_IMAGES }));
        return prev;
      }
      const accepted = imageFiles.slice(0, slotsLeft);
      if (accepted.length < imageFiles.length) {
        toast.error(t('clipboard.limitReached', { max: MAX_IMAGES }));
      }
      const entries = accepted.map((blob, idx) => ({
        id: `${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 7)}`,
        url: URL.createObjectURL(blob),
        blob,
        timestamp: new Date(),
      }));
      return [...entries, ...prev];
    });
  }, [t]);

  const handlePaste = useCallback((e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageItem = Array.from(items).find(i => i.type.startsWith('image/'));
    if (!imageItem) return;
    e.preventDefault();
    const blob = imageItem.getAsFile();
    if (blob) addImages([blob]);
  }, [addImages]);

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
    addImages(files);
  }

  useEffect(() => {
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [handlePaste]);

  async function ensurePathFor(img, serverId) {
    if (!serverId) throw new Error('no server');
    if (!img._tempPaths) img._tempPaths = {};
    if (img._tempPaths[serverId]) return img._tempPaths[serverId];
    const path = await saveImageToTemp(serverId, img.blob);
    img._tempPaths[serverId] = path;
    return path;
  }

  async function handleSend(sessionId, sendEnter) {
    if (!sendingImg) return;
    const key = `${sessionId}:${sendEnter ? '1' : '0'}`;
    const { serverId } = splitSessionId(sessionId);
    setSendingKey(key);
    try {
      const path = await ensurePathFor(sendingImg, serverId);
      const data = await sendTextToSession(sessionId, `@${path}`, sendEnter);
      toast.success(data.detail);
      setSendingImg(null);
    } catch (err) {
      showError(err);
    } finally {
      setSendingKey(null);
    }
  }

  function openSendFor(e, img) {
    e.stopPropagation();
    setSendingImg(img);
  }

  async function handleSendAll(sessionId, sendEnter) {
    if (images.length === 0) return;
    const key = `${sessionId}:${sendEnter ? '1' : '0'}`;
    const { serverId } = splitSessionId(sessionId);
    setSendingKey(key);
    try {
      const paths = await Promise.all(images.map(img => ensurePathFor(img, serverId)));
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
    setImages(prev => {
      const img = prev.find(i => i.id === id);
      if (img) URL.revokeObjectURL(img.url);
      return prev.filter(i => i.id !== id);
    });
    if (previewImage?.id === id) setPreviewImage(null);
    if (sendingImg?.id === id) setSendingImg(null);
  }

  function handleClearAll() {
    images.forEach(img => URL.revokeObjectURL(img.url));
    setImages([]);
  }

  function SendToTerminalButton({ img, size = 12, className = '' }) {
    return (
      <button
        onClick={(e) => openSendFor(e, img)}
        className={`flex items-center justify-center transition-colors ${className}`}
        title={t('clipboard.sendToTerminal')}
      >
        <Send size={size} />
      </button>
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
          {images.length > 0 && (
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

        {images.length > 0 ? (
          <div className="grid grid-cols-3 gap-1 max-h-48 overflow-y-auto">
            {images.map(img => (
              <div
                key={img.id}
                className="relative aspect-video rounded overflow-hidden border border-border hover:border-primary/60 transition-colors group cursor-pointer"
                onClick={() => setPreviewImage(img)}
              >
                <img src={img.url} alt="" className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-overlay/0 group-hover:bg-overlay/40 transition-colors" />
                <div className="absolute top-0.5 right-0.5 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <SendToTerminalButton
                    img={img}
                    size={10}
                    className="p-0.5 rounded bg-overlay/60 text-white hover:bg-primary/80"
                  />
                  <button
                    onClick={(e) => handleDelete(e, img.id)}
                    className="p-0.5 rounded bg-overlay/60 text-white hover:bg-destructive/80 transition-colors"
                    title={t('clipboard.delete')}
                  >
                    <X size={10} />
                  </button>
                </div>
                <div className="absolute bottom-0 left-0 right-0 bg-overlay/60 text-[8px] text-center text-white py-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  {formatTime(img.timestamp)}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-3 gap-1 text-muted-foreground">
            <Image size={16} className="opacity-30" />
            <p className="text-[10px] opacity-50">{t('clipboard.captureHint')}</p>
          </div>
        )}
      </div>

      {previewImage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/70" onClick={() => setPreviewImage(null)}>
          <div className="relative max-w-[90vw] max-h-[90vh] bg-card border border-border rounded-lg overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-3 py-2 border-b border-border">
              <span className="text-xs text-muted-foreground">
                {formatTime(previewImage.timestamp)}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={(e) => openSendFor(e, previewImage)}
                  className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-primary/20 text-primary hover:bg-primary/30 transition-colors"
                >
                  <Send size={12} />
                  {t('clipboard.sendToTerminal')}
                </button>
                <button
                  onClick={(e) => handleDelete(e, previewImage.id)}
                  className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                  title={t('clipboard.delete')}
                >
                  <Trash2 size={14} />
                </button>
                <button
                  onClick={() => setPreviewImage(null)}
                  className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
            <div className="p-2 flex items-center justify-center" style={{ maxHeight: 'calc(90vh - 44px)' }}>
              <img
                src={previewImage.url}
                alt=""
                className="max-w-full max-h-[calc(90vh-60px)] object-contain rounded"
              />
            </div>
          </div>
        </div>
      )}

      {sendingImg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/60 px-4 py-6" onClick={() => setSendingImg(null)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-card border border-border rounded-lg p-5 w-full max-w-md flex flex-col gap-3 max-h-full overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-foreground font-semibold">{t('clipboard.sendTitle')}</h3>
              <button
                onClick={() => setSendingImg(null)}
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
              <h3 className="text-foreground font-semibold">{t('clipboard.sendTitle')} ({images.length})</h3>
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
