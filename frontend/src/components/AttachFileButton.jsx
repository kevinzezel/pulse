'use client';

import { useState, useRef } from 'react';
import { X, Send, CornerDownLeft, Terminal, Loader, Paperclip, Plus, FileIcon } from 'lucide-react';
import toast from 'react-hot-toast';
import { saveFileToTemp, sendTextToSession, splitSessionId } from '@/services/api';
import { useTranslation, useErrorToast } from '@/providers/I18nProvider';
import { getAllServers } from '@/providers/ServersProvider';
import ServerTag from './ServerTag';

let _fileCounter = 0;
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

export default function AttachFileButton({ sessions = [], iconOnly = false }) {
  const { t } = useTranslation();
  const showError = useErrorToast();
  const fileInputRef = useRef(null);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [sendingKey, setSendingKey] = useState(null);

  function handleFileChange(e) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setSelectedFiles(prev => {
      const slotsLeft = MAX_ITEMS - prev.length;
      if (slotsLeft <= 0) {
        toast.error(t('clipboard.limitReached', { max: MAX_ITEMS }));
        return prev;
      }
      const accepted = files.slice(0, slotsLeft);
      if (accepted.length < files.length) {
        toast.error(t('clipboard.limitReached', { max: MAX_ITEMS }));
      }
      const next = accepted.map(file => {
        const isImg = isImageFile(file);
        return {
          id: `${Date.now()}-${_fileCounter++}`,
          url: isImg ? URL.createObjectURL(file) : null,
          blob: file,
          name: file.name || (isImg ? 'image' : 'file'),
          size: file.size || 0,
          isImage: isImg,
          _tempPaths: {},
        };
      });
      return [...prev, ...next];
    });
    e.target.value = '';
  }

  function openPicker() {
    fileInputRef.current?.click();
  }

  function handleRemoveFile(id) {
    setSelectedFiles(prev => {
      const item = prev.find(i => i.id === id);
      if (item?.url) URL.revokeObjectURL(item.url);
      return prev.filter(i => i.id !== id);
    });
  }

  function handleClose() {
    selectedFiles.forEach(item => { if (item.url) URL.revokeObjectURL(item.url); });
    setSelectedFiles([]);
    setSendingKey(null);
  }

  async function ensurePathsFor(serverId) {
    const paths = await Promise.all(selectedFiles.map(async (item) => {
      if (!item._tempPaths[serverId]) {
        item._tempPaths[serverId] = await saveFileToTemp(serverId, item.blob, item.name);
      }
      return item._tempPaths[serverId];
    }));
    return paths;
  }

  async function handleSend(sessionId, sendEnter) {
    if (selectedFiles.length === 0) return;
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
        multiple
        className="hidden"
        onChange={handleFileChange}
      />
      {iconOnly ? (
        <button
          onClick={openPicker}
          className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
          title={t('clipboard.pickFile')}
          aria-label={t('clipboard.pickFile')}
        >
          <Paperclip size={16} />
        </button>
      ) : (
        <div className="p-3">
          <button
            onClick={openPicker}
            className="w-full flex items-center justify-center gap-2 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
            title={t('clipboard.pickFile')}
            aria-label={t('clipboard.pickFile')}
          >
            <Paperclip size={14} />
            <span className="text-xs">{t('clipboard.pickFile')}</span>
          </button>
        </div>
      )}

      {selectedFiles.length > 0 && (
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
                {t('clipboard.sendTitle')} ({selectedFiles.length})
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
              {selectedFiles.map(item => (
                <div key={item.id} className="relative flex-shrink-0 w-20 h-20 rounded border border-border overflow-hidden">
                  {item.isImage && item.url ? (
                    <img src={item.url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full w-full p-1 text-muted-foreground bg-muted/30">
                      <FileIcon size={18} />
                      <span className="mt-0.5 text-[8px] text-center truncate w-full px-1" title={item.name}>
                        {item.name}
                      </span>
                      <span className="text-[8px] opacity-60">{formatBytes(item.size)}</span>
                    </div>
                  )}
                  <button
                    onClick={() => handleRemoveFile(item.id)}
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
                title={t('clipboard.pickFile')}
                aria-label={t('clipboard.pickFile')}
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
