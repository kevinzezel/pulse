'use client';

import { useState, useRef } from 'react';
import { X, Send, CornerDownLeft, Terminal, Loader, Image as ImageIcon, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import { saveImageToTemp, sendTextToSession, splitSessionId } from '@/services/api';
import { useTranslation, useErrorToast } from '@/providers/I18nProvider';
import { getAllServers } from '@/providers/ServersProvider';
import ServerTag from './ServerTag';

let _imgCounter = 0;

export default function AttachImageButton({ sessions = [], iconOnly = false }) {
  const { t } = useTranslation();
  const showError = useErrorToast();
  const fileInputRef = useRef(null);
  const [selectedImgs, setSelectedImgs] = useState([]);
  const [sendingKey, setSendingKey] = useState(null);

  function handleFileChange(e) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    const newImgs = files.map(file => ({
      id: `${Date.now()}-${_imgCounter++}`,
      url: URL.createObjectURL(file),
      blob: file,
      _tempPaths: {},
    }));
    setSelectedImgs(prev => [...prev, ...newImgs]);
    e.target.value = '';
  }

  function openPicker() {
    fileInputRef.current?.click();
  }

  function handleRemoveImg(id) {
    setSelectedImgs(prev => {
      const img = prev.find(i => i.id === id);
      if (img) URL.revokeObjectURL(img.url);
      return prev.filter(i => i.id !== id);
    });
  }

  function handleClose() {
    selectedImgs.forEach(img => URL.revokeObjectURL(img.url));
    setSelectedImgs([]);
    setSendingKey(null);
  }

  async function ensurePathsFor(serverId) {
    const paths = await Promise.all(selectedImgs.map(async (img) => {
      if (!img._tempPaths[serverId]) {
        img._tempPaths[serverId] = await saveImageToTemp(serverId, img.blob);
      }
      return img._tempPaths[serverId];
    }));
    return paths;
  }

  async function handleSend(sessionId, sendEnter) {
    if (selectedImgs.length === 0) return;
    const key = `${sessionId}:${sendEnter ? '1' : '0'}`;
    const { serverId } = splitSessionId(sessionId);
    setSendingKey(key);
    try {
      const paths = await ensurePathsFor(serverId);
      const text = paths.map(p => `@${p}`).join(' ');
      const data = await sendTextToSession(sessionId, text, sendEnter);
      toast.success(data.detail);
      handleClose();
    } catch (err) {
      showError(err);
    } finally {
      setSendingKey(null);
    }
  }

  const busy = sendingKey !== null;

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleFileChange}
      />
      {iconOnly ? (
        <button
          onClick={openPicker}
          className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
          title={t('clipboard.pickImage')}
          aria-label={t('clipboard.pickImage')}
        >
          <ImageIcon size={16} />
        </button>
      ) : (
        <div className="p-3">
          <button
            onClick={openPicker}
            className="w-full flex items-center justify-center gap-2 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
            title={t('clipboard.pickImage')}
            aria-label={t('clipboard.pickImage')}
          >
            <ImageIcon size={14} />
            <span className="text-xs">{t('clipboard.pickImage')}</span>
          </button>
        </div>
      )}

      {selectedImgs.length > 0 && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/60 px-4 py-6"
          onClick={handleClose}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-card border border-border rounded-lg p-4 w-full max-w-md flex flex-col gap-3 max-h-full overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-foreground font-semibold text-sm">
                {t('clipboard.sendTitle')} ({selectedImgs.length})
              </h3>
              <button
                onClick={handleClose}
                disabled={busy}
                className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
              {selectedImgs.map(img => (
                <div key={img.id} className="relative flex-shrink-0 w-20 h-20 rounded border border-border overflow-hidden">
                  <img src={img.url} alt="" className="w-full h-full object-cover" />
                  <button
                    onClick={() => handleRemoveImg(img.id)}
                    disabled={busy}
                    className="absolute top-0.5 right-0.5 p-0.5 rounded-full bg-overlay/70 text-white hover:bg-destructive/80 disabled:opacity-50"
                    title={t('clipboard.delete')}
                    aria-label={t('clipboard.delete')}
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
              <button
                onClick={openPicker}
                disabled={busy}
                className="flex-shrink-0 w-20 h-20 rounded border border-dashed border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-50"
                title={t('clipboard.pickImage')}
                aria-label={t('clipboard.pickImage')}
              >
                <Plus size={20} />
              </button>
            </div>

            {sessions.length === 0 ? (
              <div className="py-4 text-center text-sm text-muted-foreground">
                {t('clipboard.noSessions')}
              </div>
            ) : (
              <ul className="space-y-2">
                {sessions.map(s => (
                  <li key={s.id} className="flex items-center gap-2 p-2 rounded-md border border-border">
                    <Terminal size={14} className="text-muted-foreground flex-shrink-0" />
                    <span className="flex-1 min-w-0 truncate text-xs text-foreground">{s.name}</span>
                    {s.server_name && getAllServers().length > 1 && (
                      <ServerTag name={s.server_name} color={s.server_color} />
                    )}
                    <button
                      onClick={() => handleSend(s.id, false)}
                      disabled={busy}
                      className="inline-flex items-center justify-center p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-50"
                      title={t('clipboard.sendOnly')}
                      aria-label={t('clipboard.sendOnly')}
                    >
                      {sendingKey === `${s.id}:0` ? <Loader size={12} className="animate-spin" /> : <Send size={12} />}
                    </button>
                    <button
                      onClick={() => handleSend(s.id, true)}
                      disabled={busy}
                      className="inline-flex items-center justify-center p-1.5 rounded text-white bg-brand-gradient hover:opacity-90 disabled:opacity-50"
                      title={t('clipboard.sendEnter')}
                      aria-label={t('clipboard.sendEnter')}
                    >
                      {sendingKey === `${s.id}:1` ? <Loader size={12} className="animate-spin" /> : <CornerDownLeft size={12} />}
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
