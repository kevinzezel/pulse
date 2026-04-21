'use client';

import { useState, useEffect } from 'react';
import { Monitor, Columns2, Rows2, FolderOpen, ExternalLink, Maximize2, Minimize2, X, Loader, FileText } from 'lucide-react';
import { Mosaic, MosaicWindow } from 'react-mosaic-component';
import 'react-mosaic-component/react-mosaic-component.css';
import { openEditor, getSessionCwd, splitSessionId } from '@/services/api';
import { useTranslation, useErrorToast } from '@/providers/I18nProvider';
import { getServerById } from '@/providers/ServersProvider';
import { isLocalHost } from '@/utils/host';
import TerminalPane from './TerminalPane';
import TerminalCaptureModal from './TerminalCaptureModal';
import ServerTag from './ServerTag';

function PaneToolbar({ t, sessionId, onSplitH, onSplitV, onOpenEditor, openingEditor, onOpenRemoteEditor, openingRemoteEditor, onMaximize, isMaximized, onClose, isBusy, isLocal }) {
  const opening = openingEditor || openingRemoteEditor;
  return (
    <div className="mosaic-toolbar-actions flex items-center gap-0.5 mr-1">
      {isBusy ? (
        <span className="mosaic-tool-btn" style={{ opacity: 1 }}>
          <Loader size={12} className="animate-spin text-primary" />
        </span>
      ) : (
        <>
          <button onClick={() => onSplitH(sessionId)} className="mosaic-tool-btn" title={t('toolbar.splitH')}>
            <Columns2 size={12} />
          </button>
          <button onClick={() => onSplitV(sessionId)} className="mosaic-tool-btn" title={t('toolbar.splitV')}>
            <Rows2 size={12} />
          </button>
        </>
      )}
      <button
        onClick={() => isLocal ? onOpenEditor(sessionId) : onOpenRemoteEditor(sessionId)}
        disabled={opening}
        className="mosaic-tool-btn"
        title={isLocal ? t('toolbar.openEditorLocal') : t('toolbar.openEditorRemote')}
      >
        {opening ? <Loader size={12} className="animate-spin" /> : (isLocal ? <FolderOpen size={12} /> : <ExternalLink size={12} />)}
      </button>
      <button onClick={() => onMaximize(sessionId)} className="mosaic-tool-btn" title={isMaximized ? t('toolbar.restore') : t('toolbar.maximize')}>
        {isMaximized ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
      </button>
      <button onClick={() => onClose(sessionId)} className="mosaic-tool-btn text-muted-foreground hover:text-destructive" title={t('toolbar.close')}>
        <X size={12} />
      </button>
    </div>
  );
}

// Floating "Capture as text" button overlaid on every pane (desktop + mobile).
// Matches the "selected group chip" styling (primary accent on a tinted
// background) so it's clearly a persistent action, without being as loud as
// the brand-gradient CTA.
function CaptureFloatingButton({ t, sessionId, onCapture }) {
  return (
    <button
      onClick={() => onCapture(sessionId)}
      title={t('toolbar.capture')}
      aria-label={t('toolbar.capture')}
      className="absolute top-2 right-4 z-10 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-primary/50 bg-primary/15 text-primary shadow-sm hover:bg-primary/25 active:scale-95 transition-all"
    >
      <FileText size={14} strokeWidth={2.25} />
      <span className="hidden sm:inline text-xs font-semibold">
        {t('toolbar.captureLabel')}
      </span>
    </button>
  );
}

function EmptyState({ t }) {
  return (
    <div
      className="flex flex-col items-center justify-start h-full gap-3 px-6 pt-16 sm:pt-24 text-center"
      style={{ background: 'hsl(var(--terminal-bg))' }}
    >
      <Monitor size={32} className="text-muted-foreground" />
      <p className="text-muted-foreground text-sm">{t('mosaic.emptyState')}</p>
    </div>
  );
}

function MobileTabBar({ sessions, activeId, onSelect, onClose, t }) {
  return (
    <div
      className="flex items-center h-9 overflow-x-auto border-b flex-shrink-0"
      style={{
        background: 'hsl(var(--terminal-header))',
        borderColor: 'hsl(var(--terminal-border))',
        scrollbarWidth: 'none',
      }}
    >
      {sessions.map(session => (
        <button
          key={session.id}
          onClick={() => onSelect(session.id)}
          className={`flex items-center gap-1.5 px-3 h-full text-xs whitespace-nowrap
            border-b-2 transition-colors ${
            session.id === activeId
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground'
          }`}
        >
          <span className="truncate max-w-[120px]">{session.name}</span>
          <span
            onClick={(e) => { e.stopPropagation(); onClose(session.id); }}
            className="ml-1 p-0.5 rounded hover:bg-muted/50"
          >
            <X size={10} />
          </span>
        </button>
      ))}
    </div>
  );
}

export default function TerminalMosaic({
  sessions,
  layout,
  onLayoutChange,
  onSplitH,
  onSplitV,
  onClose,
  onMaximize,
  isMaximized,
  onSessionEnded,
  busySessionIds,
  onTileDragStart,
  onTileDragEnd,
  isMobile,
  activeTerminalId,
  onActiveTerminalChange,
  mobileOpenIds,
  onMobileClose,
}) {
  const { t } = useTranslation();
  const showError = useErrorToast();
  const [openingEditorId, setOpeningEditorId] = useState(null);
  const [openingRemoteId, setOpeningRemoteId] = useState(null);
  const [captureSessionId, setCaptureSessionId] = useState(null);
  const [isLocal, setIsLocal] = useState(false);

  function handleCapture(sessionId) {
    setCaptureSessionId(sessionId);
  }

  const activeCaptureSession = captureSessionId ? findSession(captureSessionId) : null;

  useEffect(() => { setIsLocal(isLocalHost()); }, []);

  function findSession(id) {
    return sessions.find(s => s.id === id);
  }

  async function handleOpenEditor(sessionId) {
    if (openingEditorId) return;
    setOpeningEditorId(sessionId);
    try {
      await openEditor(sessionId);
    } catch (err) {
      showError(err);
    } finally {
      setOpeningEditorId(null);
    }
  }

  async function handleOpenRemoteEditor(sessionId) {
    if (openingRemoteId) return;
    setOpeningRemoteId(sessionId);
    try {
      const data = await getSessionCwd(sessionId);
      const { serverId } = splitSessionId(sessionId);
      const server = getServerById(serverId);
      const host = server?.host || window.location.hostname;
      const url = `vscode://vscode-remote/ssh-remote+${host}${data.cwd}`;
      window.open(url, '_self');
    } catch (err) {
      showError(err);
    } finally {
      setOpeningRemoteId(null);
    }
  }

  if (isMobile) {
    const openSessions = sessions.filter(s => mobileOpenIds.includes(s.id));

    return (
      <>
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          {openSessions.length > 0 && (
            <MobileTabBar
              sessions={openSessions}
              activeId={activeTerminalId}
              onSelect={onActiveTerminalChange}
              onClose={onMobileClose}
              t={t}
            />
          )}
          <div className="flex-1 min-h-0 relative">
            {mobileOpenIds.map(id => {
              const session = findSession(id);
              if (!session) return null;
              return (
                <div
                  key={id}
                  className="absolute inset-0"
                  style={{ display: id === activeTerminalId ? 'block' : 'none' }}
                >
                  <TerminalPane
                    session={session}
                    onSessionEnded={() => onSessionEnded(id)}
                    isMobile={true}
                  />
                  {id === activeTerminalId && (
                    <CaptureFloatingButton t={t} sessionId={id} onCapture={handleCapture} />
                  )}
                </div>
              );
            })}
            {mobileOpenIds.length === 0 && <EmptyState t={t} />}
          </div>
        </div>
        {activeCaptureSession && (
          <TerminalCaptureModal
            sessionId={activeCaptureSession.id}
            sessionName={activeCaptureSession.name}
            onClose={() => setCaptureSessionId(null)}
          />
        )}
      </>
    );
  }

  return (
    <>
    <div className="flex-1 min-h-0 min-w-0" style={{ padding: '2px' }}>
      <Mosaic
        value={layout}
        onChange={onLayoutChange}
        className="mosaic-dark-theme"
        renderTile={(id, path) => {
          const session = findSession(id);
          if (!session) return <EmptyState t={t} />;

          return (
            <MosaicWindow
              path={path}
              title={session.name}
              draggable={!isMobile}
              onDragStart={() => onTileDragStart(id)}
              onDragEnd={() => onTileDragEnd(id)}
              toolbarControls={
                <PaneToolbar
                  t={t}
                  sessionId={id}
                  onSplitH={onSplitH}
                  onSplitV={onSplitV}
                  onOpenEditor={handleOpenEditor}
                  openingEditor={openingEditorId === id}
                  onOpenRemoteEditor={handleOpenRemoteEditor}
                  openingRemoteEditor={openingRemoteId === id}
                  onMaximize={onMaximize}
                  isMaximized={isMaximized}
                  onClose={onClose}
                  isBusy={busySessionIds.has(id)}
                  isLocal={isLocal}
                />
              }
            >
              <div className="relative h-full min-h-0">
                <TerminalPane
                  session={session}
                  onSessionEnded={() => onSessionEnded(id)}
                />
                <CaptureFloatingButton t={t} sessionId={id} onCapture={handleCapture} />
              </div>
            </MosaicWindow>
          );
        }}
        zeroStateView={<EmptyState t={t} />}
      />
    </div>
    {activeCaptureSession && (
      <TerminalCaptureModal
        sessionId={activeCaptureSession.id}
        sessionName={activeCaptureSession.name}
        onClose={() => setCaptureSessionId(null)}
      />
    )}
    </>
  );
}
