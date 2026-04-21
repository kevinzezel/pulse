'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import {
  FolderOpen, ExternalLink, Loader, Folder, EyeOff, Eye, Plus, Pencil, Trash2, X,
} from 'lucide-react';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  openEditor,
  getSessionCwd,
  splitSessionId,
  createGroup,
  renameGroup,
  deleteGroup,
  setGroupHidden,
} from '@/services/api';
import { getServerById } from '@/providers/ServersProvider';
import { useTranslation, useErrorToast } from '@/providers/I18nProvider';
import { isLocalHost } from '@/utils/host';

export const NO_GROUP_VALUE = null;

function SortableGroupChip({ chip, renderChipContent }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: chip.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return renderChipContent({
    chip,
    dragRef: setNodeRef,
    dragStyle: style,
    dragAttributes: attributes,
    dragListeners: listeners,
    isSortableDragging: isDragging,
  });
}

function PortalPopover({ anchor, align = 'left', onClose, children }) {
  if (typeof document === 'undefined' || !anchor) return null;
  const positionStyle = {
    position: 'fixed',
    top: anchor.bottom + 4,
    zIndex: 9999,
    ...(align === 'right'
      ? { right: Math.max(8, window.innerWidth - anchor.right) }
      : { left: Math.max(8, anchor.left) }),
  };
  return createPortal(
    <>
      <div
        className="fixed inset-0"
        style={{ zIndex: 9998 }}
        onMouseDown={onClose}
      />
      <div
        className="rounded-md border p-2 shadow-lg min-w-[220px]"
        style={{
          ...positionStyle,
          background: 'hsl(var(--card))',
          color: 'hsl(var(--foreground))',
          borderColor: 'hsl(var(--border))',
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}

export default function GroupSelector({
  groups = [],
  sessions = [],
  selectedGroupId,
  onSelect,
  onHideGroup,
  onReorder,
  onGroupsChanged,
  isMobile = false,
  showOpenAll = true,
}) {
  const visibleGroups = useMemo(() => groups.filter((g) => !g.hidden), [groups]);
  const hiddenGroups = useMemo(() => groups.filter((g) => g.hidden), [groups]);
  const { t } = useTranslation();
  const showError = useErrorToast();

  const [openingGroupKey, setOpeningGroupKey] = useState(null);
  const [isLocal, setIsLocal] = useState(false);

  // popover = null | { type: 'hidden', anchor }
  const [popover, setPopover] = useState(null);
  const [creatingOpen, setCreatingOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [newName, setNewName] = useState('');
  const [editName, setEditName] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const createInputRef = useRef(null);
  const editInputRef = useRef(null);

  useEffect(() => {
    setIsLocal(isLocalHost());
  }, []);

  useEffect(() => {
    if (creatingOpen) {
      const id = setTimeout(() => createInputRef.current?.focus(), 30);
      return () => clearTimeout(id);
    }
    if (editingId) {
      const id = setTimeout(() => editInputRef.current?.focus(), 30);
      return () => clearTimeout(id);
    }
  }, [creatingOpen, editingId]);

  useEffect(() => {
    function onKey(e) {
      if (e.key !== 'Escape') return;
      if (popover) setPopover(null);
      else if (creatingOpen && !submitting) setCreatingOpen(false);
      else if (editingId && !submitting) setEditingId(null);
      else if (confirmDeleteId && !submitting) setConfirmDeleteId(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [popover, creatingOpen, editingId, confirmDeleteId, submitting]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event) {
    const { active, over } = event;
    if (!active || active.id == null) return;
    const activeId = active.id;
    const targetId = over?.id;

    if (!targetId) {
      const lastId = visibleGroups.length > 0 ? visibleGroups[visibleGroups.length - 1].id : null;
      if (!lastId || activeId === lastId) return;
      onReorder?.(activeId, lastId);
      return;
    }

    if (activeId === targetId) return;
    onReorder?.(activeId, targetId);
  }

  const countsByGroup = useMemo(() => {
    const validGroupIds = new Set(visibleGroups.map((g) => g.id));
    const counts = new Map();
    counts.set('__none__', 0);
    for (const g of visibleGroups) counts.set(g.id, 0);
    for (const s of sessions) {
      const gid = s.group_id && validGroupIds.has(s.group_id) ? s.group_id : '__none__';
      counts.set(gid, (counts.get(gid) || 0) + 1);
    }
    return counts;
  }, [sessions, visibleGroups]);

  async function openAllInGroup(e, groupId) {
    e.stopPropagation();
    const key = groupId ?? '__none__';
    if (openingGroupKey) return;
    const validGroupIds = new Set(visibleGroups.map((g) => g.id));
    const targets = sessions.filter((s) => {
      const gid = s.group_id && validGroupIds.has(s.group_id) ? s.group_id : null;
      return gid === groupId;
    });
    if (targets.length === 0) {
      toast(t('groupSelector.nothingToOpen'));
      return;
    }
    setOpeningGroupKey(key);
    let done = 0;
    let failed = 0;
    for (const session of targets) {
      try {
        if (isLocal) {
          await openEditor(session.id);
        } else {
          const data = await getSessionCwd(session.id);
          const { serverId } = splitSessionId(session.id);
          const server = getServerById(serverId);
          const host = server?.host || window.location.hostname;
          const url = `vscode://vscode-remote/ssh-remote+${host}${data.cwd}`;
          window.open(url, '_blank');
        }
        done += 1;
      } catch (err) {
        failed += 1;
        console.warn('[openAllInGroup] failed for', session.id, err);
      }
    }
    setOpeningGroupKey(null);
    if (failed === 0) {
      toast.success(t('groupSelector.openAllDone', { n: done }));
    } else if (done === 0) {
      showError(new Error(t('groupSelector.openAllPartial', { done, total: targets.length, failed })));
    } else {
      toast(t('groupSelector.openAllPartial', { done, total: targets.length, failed }), { icon: '⚠' });
    }
  }

  function anchorFromEvent(e) {
    return e.currentTarget.getBoundingClientRect();
  }

  function openCreateModal() {
    setNewName('');
    setCreatingOpen(true);
  }

  function openEditModal(e, group) {
    e.stopPropagation();
    setEditName(group.name);
    setEditingId(group.id);
  }

  function openHiddenPopover(e) {
    e.stopPropagation();
    setPopover({ type: 'hidden', anchor: anchorFromEvent(e) });
  }

  function closePopover() {
    setPopover(null);
  }

  async function submitCreate() {
    if (submitting) return;
    const name = newName.trim();
    if (!name) return;
    setSubmitting(true);
    try {
      await createGroup(name);
      setNewName('');
      setCreatingOpen(false);
      onGroupsChanged?.();
      toast.success(t('success.group_created'));
    } catch (err) {
      showError(err);
    } finally {
      setSubmitting(false);
    }
  }

  async function submitRename(id) {
    if (submitting) return;
    const name = editName.trim();
    if (!name) return;
    setSubmitting(true);
    try {
      await renameGroup(id, name);
      setEditName('');
      setEditingId(null);
      onGroupsChanged?.();
      toast.success(t('success.group_renamed'));
    } catch (err) {
      showError(err);
    } finally {
      setSubmitting(false);
    }
  }

  async function submitDelete(id) {
    if (submitting) return;
    setSubmitting(true);
    try {
      await deleteGroup(id);
      if (selectedGroupId === id) onSelect?.(null);
      setConfirmDeleteId(null);
      onGroupsChanged?.();
      toast.success(t('success.group_deleted'));
    } catch (err) {
      showError(err);
    } finally {
      setSubmitting(false);
    }
  }

  async function submitUnhide(id) {
    if (submitting) return;
    setSubmitting(true);
    try {
      await setGroupHidden(id, false);
      onGroupsChanged?.();
      if (hiddenGroups.length === 1) closePopover();
      toast.success(t('success.group_shown'));
    } catch (err) {
      showError(err);
    } finally {
      setSubmitting(false);
    }
  }

  function renderChipContent({ chip, dragRef, dragStyle, dragAttributes, dragListeners, isSortableDragging }) {
    const { id, name, isNoGroup } = chip;
    const countKey = id ?? '__none__';
    const count = countsByGroup.get(countKey) || 0;
    const isActive = selectedGroupId === id;
    const isOpening = openingGroupKey === countKey;
    const disabledBtn = count === 0 || isOpening;
    const canReorderThis = !isMobile && !!onReorder && !isNoGroup;

    return (
      <div
        key={countKey}
        ref={dragRef}
        style={{ ...(dragStyle || {}) }}
        {...(dragAttributes || {})}
        {...(dragListeners || {})}
        role="button"
        tabIndex={0}
        onClick={() => onSelect(id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect(id);
          }
        }}
        className={`group flex-shrink-0 flex items-center gap-1.5 pl-2.5 pr-1 h-7 rounded-full border text-xs transition-colors select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          isActive
            ? 'border-primary/50 bg-primary/15 text-primary'
            : 'border-border bg-card text-foreground hover:bg-muted/40'
        } ${isSortableDragging ? 'shadow-lg' : ''} ${canReorderThis ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}`}
      >
        <Folder size={11} className={isActive ? 'text-primary' : 'text-muted-foreground'} />
        <span className="truncate max-w-[160px]">{name}</span>
        <span
          className={`text-[10px] px-1 rounded ${
            isActive ? 'text-primary/80 bg-primary/10' : 'text-muted-foreground bg-muted/40'
          }`}
        >
          {count}
        </span>
        {showOpenAll && (
          <span
            onClick={(e) => (disabledBtn ? e.stopPropagation() : openAllInGroup(e, id))}
            onPointerDown={(e) => e.stopPropagation()}
            aria-disabled={disabledBtn}
            title={t('groupSelector.openAllEditors')}
            className={`ml-0.5 p-1 rounded-full transition-colors cursor-pointer ${
              disabledBtn
                ? 'text-muted-foreground opacity-40 pointer-events-none'
                : 'text-muted-foreground hover:text-primary hover:bg-muted/60'
            }`}
          >
            {isOpening
              ? <Loader size={12} className="animate-spin" />
              : isLocal ? <FolderOpen size={12} /> : <ExternalLink size={12} />}
          </span>
        )}
        {!isNoGroup && (
          <>
            <span
              role="button"
              onClick={(e) => openEditModal(e, { id, name })}
              onPointerDown={(e) => e.stopPropagation()}
              title={t('groups.rename')}
              className="rounded-full text-muted-foreground hover:text-primary hover:bg-muted/60 transition-all opacity-0 max-w-0 overflow-hidden group-hover:opacity-100 group-hover:max-w-[28px] group-hover:p-1 cursor-pointer flex items-center justify-center"
            >
              <Pencil size={11} />
            </span>
            <span
              role="button"
              onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(id); }}
              onPointerDown={(e) => e.stopPropagation()}
              title={t('groups.delete')}
              className="rounded-full text-muted-foreground hover:text-destructive hover:bg-muted/60 transition-all opacity-0 max-w-0 overflow-hidden group-hover:opacity-100 group-hover:max-w-[28px] group-hover:p-1 cursor-pointer flex items-center justify-center"
            >
              <Trash2 size={11} />
            </span>
            {onHideGroup && (
              <span
                role="button"
                onClick={(e) => { e.stopPropagation(); onHideGroup(id); }}
                onPointerDown={(e) => e.stopPropagation()}
                title={t('groupSelector.hideGroup')}
                className="rounded-full text-muted-foreground hover:text-destructive hover:bg-muted/60 transition-all opacity-0 max-w-0 overflow-hidden group-hover:opacity-100 group-hover:max-w-[28px] group-hover:p-1 cursor-pointer flex items-center justify-center"
              >
                <EyeOff size={11} />
              </span>
            )}
          </>
        )}
      </div>
    );
  }

  const sortableIds = useMemo(() => visibleGroups.map((g) => g.id), [visibleGroups]);
  const noGroupChip = { id: null, name: t('groupSelector.noGroup'), isNoGroup: true };

  const containerClass = 'flex-shrink-0 flex items-center gap-1.5 px-2 py-1.5 overflow-x-auto border-b';
  const containerStyle = {
    background: 'hsl(var(--sidebar-bg))',
    borderColor: 'hsl(var(--sidebar-border))',
    scrollbarWidth: 'thin',
  };
  const plainChipProps = {
    dragRef: undefined,
    dragStyle: undefined,
    dragAttributes: undefined,
    dragListeners: undefined,
    isSortableDragging: false,
  };

  const addChip = (
    <button
      type="button"
      onClick={openCreateModal}
      title={t('groups.newGroup')}
      aria-label={t('groups.newGroup')}
      className="flex-shrink-0 flex items-center justify-center h-7 w-7 rounded-full border border-dashed text-muted-foreground hover:text-primary hover:border-primary/50 hover:bg-muted/40 transition-colors"
      style={{ borderColor: 'hsl(var(--border))' }}
    >
      <Plus size={14} />
    </button>
  );

  const hiddenChip = hiddenGroups.length > 0 ? (
    <button
      type="button"
      onClick={openHiddenPopover}
      title={t('groupSelector.showHidden')}
      className="flex-shrink-0 flex items-center gap-1 h-7 px-2 rounded-full border text-xs text-muted-foreground hover:text-primary hover:bg-muted/40 transition-colors"
      style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))' }}
    >
      <Eye size={12} />
      <span className="text-[10px] px-1 rounded bg-muted/60 text-muted-foreground">
        {hiddenGroups.length}
      </span>
    </button>
  ) : null;

  const chipRow = isMobile ? (
    <div className={containerClass} style={containerStyle}>
      {renderChipContent({ chip: noGroupChip, ...plainChipProps })}
      {visibleGroups.map((g) => renderChipContent({
        chip: { id: g.id, name: g.name, isNoGroup: false },
        ...plainChipProps,
      }))}
      {addChip}
      {hiddenChip}
    </div>
  ) : (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <div className={containerClass} style={containerStyle}>
        {renderChipContent({ chip: noGroupChip, ...plainChipProps })}
        <SortableContext items={sortableIds} strategy={horizontalListSortingStrategy}>
          {visibleGroups.map((g) => (
            <SortableGroupChip
              key={g.id}
              chip={{ id: g.id, name: g.name, isNoGroup: false }}
              renderChipContent={renderChipContent}
            />
          ))}
        </SortableContext>
        {addChip}
        {hiddenChip}
      </div>
    </DndContext>
  );

  const deleteTarget = confirmDeleteId ? groups.find((g) => g.id === confirmDeleteId) : null;
  const deleteCount = deleteTarget ? (countsByGroup.get(deleteTarget.id) || 0) : 0;

  return (
    <>
      {chipRow}

      {creatingOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-overlay/60 px-4">
          <div className="bg-card border border-border rounded-lg p-6 w-full max-w-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-foreground font-semibold">{t('groups.newGroup')}</h3>
              <button
                type="button"
                onClick={() => { if (!submitting) setCreatingOpen(false); }}
                disabled={submitting}
                className="text-muted-foreground hover:text-foreground disabled:opacity-60"
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); submitCreate(); }}>
              <label className="block text-sm text-muted-foreground mb-1">
                {t('groups.namePlaceholder')}
              </label>
              <input
                ref={createInputRef}
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t('groups.namePlaceholder')}
                maxLength={50}
                autoFocus
                disabled={submitting}
                className="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring mb-4"
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={submitting || !newName.trim()}
                  className="flex-1 py-2 rounded-md text-sm font-medium text-white bg-brand-gradient hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
                >
                  {submitting ? t('groups.creating') : t('groups.create')}
                </button>
                <button
                  type="button"
                  onClick={() => setCreatingOpen(false)}
                  disabled={submitting}
                  className="px-3 py-2 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 disabled:opacity-60 transition-colors"
                >
                  {t('groups.cancel')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editingId && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-overlay/60 px-4">
          <div className="bg-card border border-border rounded-lg p-6 w-full max-w-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-foreground font-semibold">{t('groups.rename')}</h3>
              <button
                type="button"
                onClick={() => { if (!submitting) setEditingId(null); }}
                disabled={submitting}
                className="text-muted-foreground hover:text-foreground disabled:opacity-60"
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); submitRename(editingId); }}>
              <label className="block text-sm text-muted-foreground mb-1">
                {t('groups.namePlaceholder')}
              </label>
              <input
                ref={editInputRef}
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder={t('groups.namePlaceholder')}
                maxLength={50}
                autoFocus
                disabled={submitting}
                className="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring mb-4"
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={submitting || !editName.trim()}
                  className="flex-1 py-2 rounded-md text-sm font-medium text-white bg-brand-gradient hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
                >
                  {submitting ? t('groups.renaming') : t('groups.rename')}
                </button>
                <button
                  type="button"
                  onClick={() => setEditingId(null)}
                  disabled={submitting}
                  className="px-3 py-2 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 disabled:opacity-60 transition-colors"
                >
                  {t('groups.cancel')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {popover?.type === 'hidden' && (
        <PortalPopover anchor={popover.anchor} align="right" onClose={closePopover}>
          <div className="mb-1.5 text-[11px] font-semibold text-muted-foreground px-1">
            {t('groupSelector.hiddenGroups')}
          </div>
          {hiddenGroups.length === 0 ? (
            <div className="px-1 py-2 text-xs text-muted-foreground">
              {t('groupSelector.noHidden')}
            </div>
          ) : (
            <ul className="flex flex-col gap-0.5 max-h-60 overflow-y-auto">
              {hiddenGroups.map((g) => (
                <li key={g.id} className="flex items-center gap-1 px-1 py-1 rounded hover:bg-muted/40">
                  <Folder size={11} className="text-muted-foreground flex-shrink-0" />
                  <span className="text-xs truncate flex-1">{g.name}</span>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => submitUnhide(g.id)}
                    title={t('groupSelector.unhide')}
                    className="rounded p-1 text-muted-foreground hover:text-primary hover:bg-muted/60 disabled:opacity-60"
                  >
                    <Eye size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </PortalPopover>
      )}

      {deleteTarget && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          style={{ background: 'hsl(var(--overlay) / 0.6)' }}
          onMouseDown={() => { if (!submitting) setConfirmDeleteId(null); }}
        >
          <div
            className="w-full max-w-sm rounded-lg border p-6 shadow-xl"
            style={{ background: 'hsl(var(--card))', color: 'hsl(var(--foreground))', borderColor: 'hsl(var(--border))' }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h3 className="mb-2 font-semibold">{t('groups.deleteConfirmTitle')}</h3>
            <p className="mb-4 text-sm text-muted-foreground">
              <span className="text-foreground font-medium">{deleteTarget.name}</span>
              {' — '}
              {deleteCount === 0
                ? t('groups.deleteConfirmMessageZero')
                : t('groups.deleteConfirmMessage', { n: deleteCount })}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={submitting}
                onClick={() => setConfirmDeleteId(null)}
                className="rounded px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-60"
              >
                {t('groups.cancel')}
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => submitDelete(deleteTarget.id)}
                className="rounded px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
                style={{ background: 'hsl(var(--destructive))' }}
              >
                {submitting ? t('groups.deleting') : t('groups.deleteConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
