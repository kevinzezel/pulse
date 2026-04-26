'use client';

import { useState } from 'react';
import {
  Plus, Search, X, Pencil, Trash2, Loader2, Loader, Copy, Workflow, Folder, Check,
} from 'lucide-react';
import { useTranslation } from '@/providers/I18nProvider';
import SidebarShell from '../SidebarShell';
import SidebarCard from '../SidebarCard';
import RenameFlowModal from './RenameFlowModal';

export default function FlowsSidebar({
  flows,
  groups = [],
  getFlowGroupId = (flow) => (flow && flow.group_id) || null,
  selectedFlowId,
  savingIds,
  creating,
  isOpen,
  setIsOpen,
  isMobile,
  searchQuery,
  setSearchQuery,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onDuplicate,
  onAssignGroup,
  onCreateGroupInline,
}) {
  const { t } = useTranslation();
  const [renameFlowId, setRenameFlowId] = useState(null);
  const [renaming, setRenaming] = useState(false);
  const [assignPopoverFlowId, setAssignPopoverFlowId] = useState(null);
  const [assigningGroup, setAssigningGroup] = useState(false);
  const [creatingInlineFor, setCreatingInlineFor] = useState(null);
  const [inlineGroupName, setInlineGroupName] = useState('');

  async function handleRenameSubmit(newName) {
    if (!renameFlowId) return;
    setRenaming(true);
    try {
      await onRename(renameFlowId, newName);
      setRenameFlowId(null);
    } catch {
      // keep modal open so the user doesn't lose their input
    } finally {
      setRenaming(false);
    }
  }

  function openAssignPopover(e, flowId) {
    e.stopPropagation();
    setAssignPopoverFlowId((prev) => (prev === flowId ? null : flowId));
    setCreatingInlineFor(null);
    setInlineGroupName('');
  }

  function closeAssignPopover() {
    setAssignPopoverFlowId(null);
    setCreatingInlineFor(null);
    setInlineGroupName('');
  }

  async function handlePickGroup(flowId, groupId) {
    if (!onAssignGroup) return;
    setAssigningGroup(true);
    try {
      await onAssignGroup(flowId, groupId);
      closeAssignPopover();
    } finally {
      setAssigningGroup(false);
    }
  }

  async function handleCreateGroupInlineSubmit(e, flowId) {
    e.preventDefault();
    if (!onCreateGroupInline || !onAssignGroup) return;
    const name = inlineGroupName.trim();
    if (!name) return;
    setAssigningGroup(true);
    try {
      const group = await onCreateGroupInline(name);
      await onAssignGroup(flowId, group.id);
      closeAssignPopover();
    } catch {
      // showError já foi chamado pelo handler do parent
    } finally {
      setAssigningGroup(false);
    }
  }

  return (
    <>
      <SidebarShell isOpen={isOpen} setIsOpen={setIsOpen} isMobile={isMobile}>
        {isOpen ? (
          <>
            <div className="p-3 pb-2 flex flex-col gap-2">
              <button
                type="button"
                onClick={onCreate}
                disabled={creating}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium text-white bg-brand-gradient hover:opacity-90 transition-opacity disabled:opacity-60"
              >
                {creating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                {creating ? t('flows.creating') : t('flows.newFlow')}
              </button>
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
                    type="button"
                    onClick={() => setSearchQuery('')}
                    title={t('sidebar.clearSearch')}
                    className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>

            <div
              className="border-t flex-1 min-h-0 flex flex-col"
              style={{ borderColor: 'hsl(var(--sidebar-border))' }}
            >
              <div className="px-2 pb-2 flex-1 min-h-0 overflow-y-auto">
                {flows.length === 0 ? (
                  <p className="px-2 py-4 text-xs text-muted-foreground text-center">
                    {searchQuery ? t('sidebar.noResults') : t('flows.empty')}
                  </p>
                ) : (
                  <div className="mt-1">
                    {flows.map((f) => {
                      const isSelected = f.id === selectedFlowId;
                      const isSaving = savingIds.has(f.id);
                      const popoverOpen = assignPopoverFlowId === f.id;
                      const visibleGroups = groups.filter((g) => !g.hidden);
                      const canAssign = !!onAssignGroup;
                      const effectiveGroupId = getFlowGroupId(f);

                      const title = (
                        <>
                          <Workflow
                            size={12}
                            className={`flex-shrink-0 ${isSelected ? 'text-primary' : 'text-muted-foreground'}`}
                          />
                          <span className="truncate">{f.name}</span>
                          {isSaving && (
                            <Loader2 size={11} className="animate-spin text-primary flex-shrink-0 ml-auto" />
                          )}
                        </>
                      );

                      const actions = (
                        <>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setRenameFlowId(f.id); }}
                            className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                            title={t('flows.rename')}
                          >
                            <Pencil size={12} />
                          </button>
                          {canAssign && (
                            <button
                              type="button"
                              onClick={(e) => openAssignPopover(e, f.id)}
                              className={`p-1 transition-colors ${popoverOpen ? 'text-primary' : 'text-muted-foreground hover:text-primary'}`}
                              title={t('flows.assignGroup')}
                            >
                              <Folder size={12} />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onDuplicate(f); }}
                            className="p-1 text-muted-foreground hover:text-primary transition-colors"
                            title={t('flows.duplicate')}
                          >
                            <Copy size={12} />
                          </button>
                          <div className="flex-1" />
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onDelete(f); }}
                            className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                            title={t('flows.delete')}
                          >
                            <Trash2 size={12} />
                          </button>
                        </>
                      );

                      return (
                        <div key={f.id} className="relative">
                          <SidebarCard
                            active={isSelected}
                            onClick={() => onSelect(f.id)}
                            title={title}
                            actions={actions}
                            alwaysExpanded={isSelected}
                          />
                          {popoverOpen && (
                            <>
                              <div className="fixed inset-0 z-40" onClick={closeAssignPopover} />
                              <div
                                className="absolute z-50 right-2 top-full mt-1 w-52 rounded-md border shadow-lg p-1"
                                style={{ background: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <button
                                  type="button"
                                  onClick={() => handlePickGroup(f.id, null)}
                                  disabled={assigningGroup}
                                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-muted/40 transition-colors ${
                                    !effectiveGroupId ? 'text-primary' : 'text-foreground'
                                  }`}
                                >
                                  <span className={`w-2 h-2 rounded-full border ${
                                    !effectiveGroupId ? 'bg-primary border-primary' : 'border-muted-foreground/60'
                                  }`} />
                                  {t('flows.noGroup')}
                                </button>
                                {visibleGroups.map((g) => (
                                  <button
                                    key={g.id}
                                    type="button"
                                    onClick={() => handlePickGroup(f.id, g.id)}
                                    disabled={assigningGroup}
                                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-muted/40 transition-colors ${
                                      effectiveGroupId === g.id ? 'text-primary' : 'text-foreground'
                                    }`}
                                  >
                                    <span className={`w-2 h-2 rounded-full border ${
                                      effectiveGroupId === g.id ? 'bg-primary border-primary' : 'border-muted-foreground/60'
                                    }`} />
                                    <span className="truncate">{g.name}</span>
                                  </button>
                                ))}

                                {onCreateGroupInline && (
                                  creatingInlineFor === f.id ? (
                                    <form
                                      onSubmit={(e) => handleCreateGroupInlineSubmit(e, f.id)}
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
                                      type="button"
                                      onClick={() => { setCreatingInlineFor(f.id); setInlineGroupName(''); }}
                                      disabled={assigningGroup}
                                      className="w-full flex items-center gap-2 px-2 py-1.5 mt-1 pt-2 border-t rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                                      style={{ borderColor: 'hsl(var(--border))' }}
                                    >
                                      <Plus size={12} />
                                      {t('sidebar.newGroupInline')}
                                    </button>
                                  )
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-3 pt-3">
            <button
              type="button"
              onClick={onCreate}
              disabled={creating}
              className="p-2 rounded-md text-white bg-brand-gradient hover:opacity-90 transition-opacity disabled:opacity-60"
              title={t('flows.newFlow')}
            >
              {creating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
            </button>
          </div>
        )}
      </SidebarShell>

      {renameFlowId && (() => {
        const flow = flows.find((f) => f.id === renameFlowId);
        if (!flow) return null;
        return (
          <RenameFlowModal
            flow={flow}
            onClose={() => !renaming && setRenameFlowId(null)}
            onSubmit={handleRenameSubmit}
            loading={renaming}
          />
        );
      })()}
    </>
  );
}
