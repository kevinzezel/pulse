'use client';

import { useState } from 'react';
import { Monitor, Columns2, Rows2, FolderOpen, ExternalLink, Maximize2, Minimize2, X, Loader } from 'lucide-react';
import { Mosaic, MosaicWindow } from 'react-mosaic-component';
import 'react-mosaic-component/react-mosaic-component.css';
import { openEditor, getSessionCwd, splitSessionId } from '@/services/api';
import { normalizeMosaicTree } from '@/utils/mosaicHelpers';
import { useTranslation, useErrorToast } from '@/providers/I18nProvider';
import { getServerById, isServerLocal, useServers } from '@/providers/ServersProvider';
import { buildRemoteEditorUrl } from '@/utils/host';
import TerminalPane from './TerminalPane';
import TerminalCaptureModal from './TerminalCaptureModal';
import PromptSelectorModal from './prompts/PromptSelectorModal';
import PaneActionsFab from './PaneActionsFab';
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
  onReconnect,
  busySessionIds,
  onTileDragStart,
  onTileDragEnd,
  isMobile,
  activeTerminalId,
  onActiveTerminalChange,
  mobileOpenIds,
  onMobileClose,
  onToggleNotify,
  onRequestCompose,
  composeLoadingId,
  onRequestVoice,
  serverReconnectKeys = {},
  restoringServerIds = new Set(),
  serverHealth = {},
  onRetryServer,
}) {
  const { t } = useTranslation();
  const showError = useErrorToast();
  // Depend on localReachable so probe results re-render the isLocal decision.
  useServers();
  const [openingEditorId, setOpeningEditorId] = useState(null);
  const [openingRemoteId, setOpeningRemoteId] = useState(null);
  const [captureSessionId, setCaptureSessionId] = useState(null);
  const [promptsModalSessionId, setPromptsModalSessionId] = useState(null);
  const [openFabSessionId, setOpenFabSessionId] = useState(null);

  function handleCapture(sessionId) {
    setCaptureSessionId(sessionId);
  }

  const activeCaptureSession = captureSessionId ? findSession(captureSessionId) : null;

  function findSession(id) {
    return sessions.find(s => s.id === id);
  }

  function isSessionLocal(sessionId) {
    const { serverId } = splitSessionId(sessionId);
    return isServerLocal(getServerById(serverId));
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
      const url = buildRemoteEditorUrl(server, data.cwd);
      if (!url) throw new Error(t('errors.remote_editor_no_target'));
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
              const reconnectVer = serverReconnectKeys[session.server_id] || 0;
              const paneHealth = serverHealth[session.server_id];
              return (
                <div
                  key={id}
                  className="absolute inset-0"
                  style={{ display: id === activeTerminalId ? 'block' : 'none' }}
                >
                  <TerminalPane
                    key={`${session.id}:${reconnectVer}`}
                    session={session}
                    onSessionEnded={() => onSessionEnded(id)}
                    onReconnect={onReconnect}
                    isMobile={true}
                    serverHealth={paneHealth}
                    isServerRestoring={restoringServerIds.has(session.server_id)}
                    onRetryServer={onRetryServer}
                  />
                  {id === activeTerminalId && (
                    <PaneActionsFab
                      sessionId={id}
                      session={session}
                      isOpen={openFabSessionId === id}
                      onToggle={() => setOpenFabSessionId(prev => prev === id ? null : id)}
                      onCapture={handleCapture}
                      onOpenPrompts={setPromptsModalSessionId}
                      onToggleNotify={onToggleNotify}
                      onRequestCompose={onRequestCompose}
                      composeLoading={composeLoadingId === id}
                      onRequestVoice={onRequestVoice}
                    />
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
        <PromptSelectorModal
          sessionId={promptsModalSessionId}
          open={!!promptsModalSessionId}
          onClose={() => setPromptsModalSessionId(null)}
        />
      </>
    );
  }

  return (
    <>
    <div className="flex-1 min-h-0 min-w-0" style={{ padding: '2px' }}>
      <Mosaic
        value={layout}
        onChange={(next) => onLayoutChange(normalizeMosaicTree(next))}
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
                  isLocal={isSessionLocal(id)}
                />
              }
            >
              <div className="relative h-full min-h-0">
                <TerminalPane
                  key={`${session.id}:${serverReconnectKeys[session.server_id] || 0}`}
                  session={session}
                  onSessionEnded={() => onSessionEnded(id)}
                  onReconnect={onReconnect}
                  serverHealth={serverHealth[session.server_id]}
                  isServerRestoring={restoringServerIds.has(session.server_id)}
                  onRetryServer={onRetryServer}
                />
                <PaneActionsFab
                  sessionId={id}
                  session={session}
                  isOpen={openFabSessionId === id}
                  onToggle={() => setOpenFabSessionId(prev => prev === id ? null : id)}
                  onCapture={handleCapture}
                  onOpenPrompts={setPromptsModalSessionId}
                  onToggleNotify={onToggleNotify}
                  onRequestCompose={onRequestCompose}
                  composeLoading={composeLoadingId === id}
                  onRequestVoice={onRequestVoice}
                />
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
    <PromptSelectorModal
      sessionId={promptsModalSessionId}
      open={!!promptsModalSessionId}
      onClose={() => setPromptsModalSessionId(null)}
    />
    </>
  );
}
