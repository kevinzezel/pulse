'use client';

import { useState, useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import {
  Plus, Check,
  Pencil, Trash2, FolderOpen, ExternalLink, Loader, Wifi, RefreshCw, Search, X, Folder,
  Bell, BellOff, Keyboard,
} from 'lucide-react';
import { openEditor, getSessionCwd, splitSessionId } from '@/services/api';
import { useTranslation, useErrorToast } from '@/providers/I18nProvider';
import { getServerById, isServerLocal } from '@/providers/ServersProvider';
import { useNotifications } from '@/providers/NotificationsProvider';
import { buildRemoteEditorUrl } from '@/utils/host';
import NewTerminalModal from './NewTerminalModal';
import RenameSessionModal from './RenameSessionModal';
import ClipboardGallery from './ClipboardGallery';
import AttachFileButton from './AttachFileButton';
import ServerTag from './ServerTag';
import SidebarShell from './SidebarShell';
import { isTerminalConnected, subscribeTerminalConnection } from './TerminalPane';

export default function Sidebar({
  sessions,
  allSessions = sessions,
  groups = [],
  servers = [],
  onCreateSession,
  onKillSession,
  onRenameSession,
  onReconnect,
  onAssignGroup,
  onCreateGroupInline,
  isOpen,
  onToggle,
  isMobile,
  visibleSessionIds,
  onSelectSession,
  activeTerminalId,
  onToggleNotify,
  onRequestCompose,
  composeLoadingId = null,
  defaultCreateGroupId = null,
  serverHealth = {},
}) {
  const showServerTag = servers.length > 1;
  const { t } = useTranslation();
  const showError = useErrorToast();
  const { supported: notifySupported, permission: notifyPermission, permissionReason: notifyPermissionReason, requestBrowserPermission } = useNotifications();
  const [showModal, setShowModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [renameSessionId, setRenameSessionId] = useState(null);
  const [renaming, setRenaming] = useState(false);
  const [confirmKillId, setConfirmKillId] = useState(null);
  const [openingEditorId, setOpeningEditorId] = useState(null);
  const [openingRemoteId, setOpeningRemoteId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTerminalConnected, setActiveTerminalConnected] = useState(false);

  const [assignPopoverSessionId, setAssignPopoverSessionId] = useState(null);
  const [creatingInlineFor, setCreatingInlineFor] = useState(null);
  const [inlineGroupName, setInlineGroupName] = useState('');
  const [assigningGroup, setAssigningGroup] = useState(false);

  useEffect(() => {
    if (!activeTerminalId) {
      setActiveTerminalConnected(false);
      return undefined;
    }
    setActiveTerminalConnected(isTerminalConnected(activeTerminalId));
    return subscribeTerminalConnection(activeTerminalId, setActiveTerminalConnected);
  }, [activeTerminalId]);

  const filteredSessions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return sessions;
    return sessions.filter(s => s.name.toLowerCase().includes(query));
  }, [sessions, searchQuery]);

  async function handleOpenEditor(e, sessionId) {
    e.stopPropagation();
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

  async function handleOpenRemoteEditor(e, sessionId) {
    e.stopPropagation();
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

  function startEditing(e, session) {
    e.stopPropagation();
    setRenameSessionId(session.id);
  }

  async function handleRenameSubmit(newName) {
    if (!renameSessionId) return;
    setRenaming(true);
    try {
      await onRenameSession(renameSessionId, newName);
      setRenameSessionId(null);
    } finally {
      setRenaming(false);
    }
  }

  async function handleCreate(serverId, name, groupId, cwd) {
    setCreating(true);
    try {
      await onCreateSession(serverId, name, groupId, cwd);
      setShowModal(false);
    } finally {
      setCreating(false);
    }
  }

  function formatAge(createdAt) {
    const diff = Date.now() - new Date(createdAt).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return t('time.now');
    if (mins < 60) return t('time.minutes', { n: mins });
    const hrs = Math.floor(mins / 60);
    return t('time.hours', { n: hrs });
  }

  function openAssignPopover(e, sessionId) {
    e.stopPropagation();
    setAssignPopoverSessionId(prev => prev === sessionId ? null : sessionId);
    setCreatingInlineFor(null);
    setInlineGroupName('');
  }

  function closeAssignPopover() {
    setAssignPopoverSessionId(null);
    setCreatingInlineFor(null);
    setInlineGroupName('');
  }

  async function handlePickGroup(sessionId, groupId) {
    setAssigningGroup(true);
    try {
      await onAssignGroup(sessionId, groupId);
      closeAssignPopover();
    } finally {
      setAssigningGroup(false);
    }
  }

  async function handleCreateGroupInlineSubmit(e, sessionId) {
    e.preventDefault();
    const name = inlineGroupName.trim();
    if (!name) return;
    setAssigningGroup(true);
    try {
      const group = await onCreateGroupInline(name);
      if (!group?.id) return;
      await onAssignGroup(sessionId, group.id);
      closeAssignPopover();
    } catch {
      // showError já foi chamado pelo handler do parent
    } finally {
      setAssigningGroup(false);
    }
  }

  const setIsOpen = (next) => { if (next !== isOpen) onToggle(); };

  function renderSessionItem(session) {
    const isVisible = visibleSessionIds.has(session.id);
    const showActions = isVisible;
    const popoverOpen = assignPopoverSessionId === session.id;
    const sessionLocal = isServerLocal(getServerById(splitSessionId(session.id).serverId));
    const sessionServerStatus = serverHealth[session.server_id]?.status || 'unknown';
    return (
      <div
        key={session.id}
        className={`group rounded-md mb-1 border transition-colors relative ${
          isVisible
            ? 'border-primary/40 bg-primary/10'
            : 'border-transparent hover:bg-muted/40'
        }`}
      >
        <div
          onClick={() => onSelectSession(session.id)}
          className="flex items-center gap-2 px-3 py-1.5 cursor-pointer"
        >
          {isVisible && (
            <div className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <p className={`text-sm truncate flex items-center gap-1 ${isVisible ? 'text-primary' : 'text-foreground'}`}>
              {session.notify_on_idle && (
                <Bell size={10} className="text-primary flex-shrink-0" />
              )}
              <span className="truncate">{session.name}</span>
            </p>
            <p className="text-[10px] text-muted-foreground truncate">
              {(() => {
                const { sessionId: backendId } = splitSessionId(session.id);
                return backendId;
              })()} &bull; {formatAge(session.created_at)}
            </p>
          </div>
          {showServerTag && (
            <div className="flex-shrink-0 ml-1">
              <ServerTag name={session.server_name} status={sessionServerStatus} />
            </div>
          )}
        </div>
        <div className={`flex items-center gap-0.5 px-3 pb-1.5 transition-all overflow-hidden ${
          showActions ? 'max-h-8 opacity-100' : 'max-h-0 opacity-0 group-hover:max-h-8 group-hover:opacity-100 group-hover:pb-1.5'
        }`} style={!showActions ? { paddingBottom: 0 } : undefined}>
          <button
            onClick={(e) => startEditing(e, session)}
            className="p-1 text-muted-foreground hover:text-foreground transition-colors"
            title={t('sidebar.rename')}
          >
            <Pencil size={12} />
          </button>
          <button
            onClick={(e) => openAssignPopover(e, session.id)}
            className={`p-1 transition-colors ${popoverOpen ? 'text-primary' : 'text-muted-foreground hover:text-primary'}`}
            title={t('sidebar.assignGroup')}
          >
            <Folder size={13} />
          </button>
          <button
            onClick={async (e) => {
              e.stopPropagation();
              const willEnable = !session.notify_on_idle;
              onToggleNotify?.(session.id, willEnable);
              if (!willEnable || !notifySupported) return;
              const deniedToast = () => {
                if (notifyPermissionReason === 'insecure-context') {
                  toast.error(t('notifications.insecureContextToast', {
                    origin: window.location.origin,
                  }), { duration: 7000 });
                } else {
                  toast.error(t('notifications.permissionDeniedToast'));
                }
              };
              if (notifyPermission === 'default') {
                const result = await requestBrowserPermission();
                if (result === 'granted') {
                  toast.success(t('notifications.permissionGrantedToast'));
                } else if (result === 'denied') {
                  deniedToast();
                }
              } else if (notifyPermission === 'denied') {
                deniedToast();
              }
            }}
            className={`p-1 transition-colors ${session.notify_on_idle ? 'text-primary' : 'text-muted-foreground hover:text-primary'}`}
            title={session.notify_on_idle ? t('sidebar.notifyOn') : t('sidebar.notifyOff')}
          >
            {session.notify_on_idle ? <Bell size={13} /> : <BellOff size={13} />}
          </button>
          <button
            onClick={(e) => sessionLocal ? handleOpenEditor(e, session.id) : handleOpenRemoteEditor(e, session.id)}
            disabled={openingEditorId === session.id || openingRemoteId === session.id}
            className="p-1 text-muted-foreground hover:text-primary transition-colors"
            title={sessionLocal ? t('sidebar.openEditorLocal') : t('sidebar.openEditorRemote')}
          >
            {(openingEditorId === session.id || openingRemoteId === session.id)
              ? <Loader size={13} className="animate-spin" />
              : (sessionLocal ? <FolderOpen size={13} /> : <ExternalLink size={13} />)}
          </button>
          <div className="flex-1" />
          <button
            onClick={(e) => { e.stopPropagation(); setConfirmKillId(session.id); }}
            className="p-1 text-muted-foreground hover:text-destructive transition-colors"
            title={t('sidebar.kill')}
          >
            <Trash2 size={13} />
          </button>
        </div>

        {popoverOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={closeAssignPopover} />
            <div
              className="absolute z-50 right-2 top-full mt-1 w-52 rounded-md border shadow-lg p-1"
              style={{ background: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => handlePickGroup(session.id, null)}
                disabled={assigningGroup}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-muted/40 transition-colors ${
                  !session.group_id ? 'text-primary' : 'text-foreground'
                }`}
              >
                <span className={`w-2 h-2 rounded-full border ${
                  !session.group_id ? 'bg-primary border-primary' : 'border-muted-foreground/60'
                }`} />
                {t('sidebar.noGroup')}
              </button>
              {groups.map(g => (
                <button
                  key={g.id}
                  onClick={() => handlePickGroup(session.id, g.id)}
                  disabled={assigningGroup}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-muted/40 transition-colors ${
                    session.group_id === g.id ? 'text-primary' : 'text-foreground'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full border ${
                    session.group_id === g.id ? 'bg-primary border-primary' : 'border-muted-foreground/60'
                  }`} />
                  <span className="truncate">{g.name}</span>
                </button>
              ))}

              {creatingInlineFor === session.id ? (
                <form
                  onSubmit={(e) => handleCreateGroupInlineSubmit(e, session.id)}
                  className="flex items-center gap-1 px-1 pt-2 mt-1 border-t"
                  style={{ borderColor: 'hsl(var(--border))' }}
                >
                  <input
                    type="text"
                    value={inlineGroupName}
                    onChange={(e) => setInlineGroupName(e.target.value)}
                    placeholder={t('sidebar.newGroupPlaceholder')}
                    maxLength={50}
                    autoFocus
                    disabled={assigningGroup}
                    className="flex-1 min-w-0 px-2 py-1 rounded bg-input border border-border text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <button
                    type="submit"
                    disabled={assigningGroup || !inlineGroupName.trim()}
                    className="p-1 text-success disabled:opacity-50"
                    title={t('sidebar.createAndAssign')}
                  >
                    {assigningGroup ? <Loader size={13} className="animate-spin" /> : <Check size={13} />}
                  </button>
                </form>
              ) : (
                <button
                  onClick={() => { setCreatingInlineFor(session.id); setInlineGroupName(''); }}
                  disabled={assigningGroup}
                  className="w-full flex items-center gap-2 px-2 py-1.5 mt-1 pt-2 border-t rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                  style={{ borderColor: 'hsl(var(--border))' }}
                >
                  <Plus size={12} />
                  {t('sidebar.newGroupInline')}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <>
      <SidebarShell isOpen={isOpen} setIsOpen={setIsOpen} isMobile={isMobile}>
        {isOpen ? (
          <>
            <div className="p-3 pb-2 flex flex-col gap-2">
              <button
                onClick={() => setShowModal(true)}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium text-white bg-brand-gradient hover:opacity-90 transition-opacity"
              >
                <Plus size={16} />
                {t('sidebar.newTerminal')}
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onReconnect?.()}
                  className="flex-1 flex items-center justify-center py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                  title={t('sidebar.reconnect')}
                  aria-label={t('sidebar.reconnect')}
                >
                  <Wifi size={14} />
                </button>
                <button
                  onClick={() => window.location.reload()}
                  className="flex-1 flex items-center justify-center py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                  title={t('sidebar.reloadPage')}
                  aria-label={t('sidebar.reloadPage')}
                >
                  <RefreshCw size={14} />
                </button>
              </div>
            </div>

            <div className="px-3 pb-2">
              <div className="flex items-center gap-1.5 rounded-md border border-border bg-input px-2 py-1">
                <Search size={12} className="text-muted-foreground flex-shrink-0" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t('sidebar.searchPlaceholder')}
                  className="flex-1 min-w-0 bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                    title={t('sidebar.clearSearch')}
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 min-h-0 flex flex-col">
              <div className="border-t flex-1 min-h-0 flex flex-col" style={{ borderColor: 'hsl(var(--sidebar-border))' }}>
                <div className="flex items-center justify-between px-3 py-1 flex-shrink-0">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {t('sidebar.sessionsSection')}
                  </p>
                </div>
                <div className="px-2 pb-2 flex-1 min-h-0 overflow-y-auto">
                  {servers.length === 0 && (
                    <p className="px-2 py-4 text-xs text-muted-foreground text-center">
                      {t('sidebar.noServers')}
                    </p>
                  )}

                  {servers.length > 0 && allSessions.length === 0 && (
                    <p className="px-2 py-4 text-xs text-muted-foreground text-center">
                      {t('sidebar.noSessions')}
                    </p>
                  )}

                  {servers.length > 0 && allSessions.length > 0 && sessions.length === 0 && (
                    <p className="px-2 py-4 text-xs text-muted-foreground text-center">
                      {t('sidebar.noSessionsInGroup')}
                    </p>
                  )}

                  {sessions.length > 0 && filteredSessions.length === 0 && (
                    <p className="px-2 py-4 text-xs text-muted-foreground text-center">
                      {t('sidebar.noResults')}
                    </p>
                  )}

                  {filteredSessions.length > 0 && (
                    <div className="mt-1">
                      {filteredSessions.map(renderSessionItem)}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {!isMobile && (
              <div className="border-t flex-shrink-0" style={{ borderColor: 'hsl(var(--sidebar-border))' }}>
                <ClipboardGallery sessions={allSessions} />
              </div>
            )}
            <div className="border-t flex-shrink-0" style={{ borderColor: 'hsl(var(--sidebar-border))' }}>
              <AttachFileButton sessions={allSessions} />
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-col items-center gap-3 pt-3">
              <button
                onClick={() => setShowModal(true)}
                className="p-2 rounded-md text-white bg-brand-gradient hover:opacity-90 transition-opacity"
                title={t('sidebar.newTerminal')}
              >
                <Plus size={16} />
              </button>
              <button
                onClick={() => onReconnect?.()}
                className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                title={t('sidebar.reconnect')}
              >
                <Wifi size={16} />
              </button>
              <button
                onClick={() => window.location.reload()}
                className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                title={t('sidebar.reloadPage')}
              >
                <RefreshCw size={16} />
              </button>
            </div>
            {isMobile && (
              <div className="mt-auto flex flex-col items-center gap-2 pb-3">
                <AttachFileButton sessions={allSessions} iconOnly />
                {(() => {
                  const composeDisabled = !activeTerminalId
                    || !activeTerminalConnected
                    || composeLoadingId === activeTerminalId;
                  const composeTitle = activeTerminalId && !activeTerminalConnected
                    ? t('terminal.actions.disconnected')
                    : t('sidebar.compose');
                  return (
                <button
                  onClick={() => activeTerminalId && activeTerminalConnected && onRequestCompose?.(activeTerminalId)}
                  disabled={composeDisabled}
                  className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                  title={composeTitle}
                  aria-label={composeTitle}
                >
                  {activeTerminalId && composeLoadingId === activeTerminalId ? <Loader size={16} className="animate-spin" /> : <Keyboard size={16} />}
                </button>
                  );
                })()}
              </div>
            )}
          </>
        )}
      </SidebarShell>

      {showModal && (
        <NewTerminalModal
          onClose={() => setShowModal(false)}
          onSubmit={handleCreate}
          loading={creating}
          groups={groups}
          servers={servers}
          defaultGroupId={defaultCreateGroupId}
        />
      )}

      {renameSessionId && (() => {
        const session = allSessions.find(s => s.id === renameSessionId);
        if (!session) return null;
        return (
          <RenameSessionModal
            session={session}
            onClose={() => !renaming && setRenameSessionId(null)}
            onSubmit={handleRenameSubmit}
            loading={renaming}
          />
        );
      })()}

      {confirmKillId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/60">
          <div className="bg-card border border-border rounded-lg p-6 w-72">
            <h3 className="text-foreground font-semibold mb-2">{t('modal.confirmKill.title')}</h3>
            <p className="text-sm text-muted-foreground mb-4">
              {t('modal.confirmKill.message', { id: confirmKillId })}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmKillId(null)}
                className="flex-1 py-2 rounded-md text-sm font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
              >
                {t('modal.confirmKill.cancel')}
              </button>
              <button
                onClick={() => { onKillSession(confirmKillId); setConfirmKillId(null); }}
                className="flex-1 py-2 rounded-md text-sm font-medium text-white bg-destructive hover:bg-destructive/80 transition-colors"
              >
                {t('modal.confirmKill.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

    </>
  );
}
