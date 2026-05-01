'use client';

import { useState, useRef, useCallback } from 'react';
import {
  Check,
  FileText,
  Image as ImageIcon,
  Loader,
  Paperclip,
  Settings2,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useTranslation, useErrorToast } from '@/providers/I18nProvider';
import {
  TASK_TITLE_MAX,
  TASK_DESCRIPTION_MAX,
  TASK_ASSIGNEE_MAX,
  TASK_ATTACHMENT_MAX_BYTES,
  TASK_ATTACHMENT_MAX_PER_TASK,
  classifyAttachment,
} from '@/lib/taskBoardsConfig';
import { uploadTaskAttachment, deleteTaskAttachment } from '@/services/api';
import {
  cleanupOrphanUploads,
  resolveInFlightUpload,
  cancelInFlightUploads,
  splitUploadCandidatesByAvailableSlots,
  consumeSessionUploadId,
} from '@/lib/taskAttachmentsCleanup';
import TaskMediaPreview from './TaskMediaPreview';

// Format a byte count as `12 kB` / `4.5 MB`. Stops at MB; attachments cap at
// 20 MB so we never need higher units.
function formatBytes(n) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} kB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// Pick a displayable file name even if the input is a generic blob (paste of
// unnamed image, drag from a webpage). Falls back to a timestamped name.
function deriveFileName(file) {
  if (file?.name && file.name.trim()) return file.name.trim();
  const ext = (() => {
    const m = (file?.type || '').match(/\/([a-z0-9+.-]+)$/i);
    return m ? `.${m[1].split('+')[0].toLowerCase()}` : '';
  })();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `pasted-${stamp}${ext}`;
}

export default function TaskEditorModal({
  task = null,
  projectId,
  boardId,
  onClose,
  onSubmit,
  onDelete,
  onClearAssignee,
  loading,
  deleting,
  assigneeOptions = [],
}) {
  const { t } = useTranslation();
  const showError = useErrorToast();
  const isExisting = Boolean(task && task.id);
  const isBusy = loading || deleting;

  const [title, setTitle] = useState(task?.title || '');
  const [description, setDescription] = useState(task?.description || '');
  const [startDate, setStartDate] = useState(task?.start_date || '');
  const [endDate, setEndDate] = useState(task?.end_date || '');
  const [assignee, setAssignee] = useState(task?.assignee || '');
  const [addingAssignee, setAddingAssignee] = useState(false);
  const [assigneeDraft, setAssigneeDraft] = useState('');
  const [managingAssignees, setManagingAssignees] = useState(false);
  const [clearingName, setClearingName] = useState(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Attachments live as a single array with status decorations. `status` is:
  //  - 'done'      -> persisted (existing on edit, or upload finished here)
  //  - 'uploading' -> active POST in flight, only the local tempId is real
  //  - 'error'     -> upload failed, kept in list so the user can retry/remove
  const initialAttachments = (task?.attachments || []).map((a) => ({ ...a, status: 'done' }));
  const [attachments, setAttachments] = useState(initialAttachments);
  // Ids of attachments uploaded by THIS modal session. On cancel-without-save
  // (BOTH new task and existing-task edits), each id gets a best-effort
  // DELETE so we don't leave orphan blobs in the index. The previous-version
  // behavior (skip cleanup on existing-task cancel) created invisible orphans
  // any time a user uploaded then changed their mind.
  const sessionUploadIdsRef = useRef([]);
  // Set to true at the moment a successful submit hands the payload to the
  // parent, so a follow-up handleClose() (in case the parent ever wires the
  // close path through the modal's own close handler) can't tear down what
  // was just saved.
  const submittedRef = useRef(false);
  // AbortController per active upload so close() can cancel in-flight POSTs.
  // Without this, an "existing task" upload that was still in flight when the
  // user closes the modal would land on the server, get stamped to the task
  // by stampAttachmentsForTask(), and become invisible to subsequent saves --
  // a permanent orphan.
  const uploadControllersRef = useRef(new Map());
  // Tracks tempIds that the user removed from the list while the POST was
  // still in flight. The success branch of `handleUpload` checks this set
  // so a late-arriving 201 (the network race AbortController can't always
  // win) tears down its own attachment via DELETE instead of inserting
  // Markdown / parking the id on sessionUploadIds.
  const cancelledTempIdsRef = useRef(new Set());
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);

  const assigneeSelectOptions = (() => {
    const seen = new Set();
    const out = [];
    for (const name of assigneeOptions) {
      const clean = String(name || '').trim();
      if (!clean || seen.has(clean.toLowerCase())) continue;
      seen.add(clean.toLowerCase());
      out.push(clean);
    }
    const current = assignee.trim();
    if (current && !seen.has(current.toLowerCase())) out.unshift(current);
    return out;
  })();

  // Count `done` AND `uploading` so a multi-file paste can't queue 50
  // uploads simultaneously and cross the 20-attachment cap. Errored rows
  // don't count -- the user has to remove them anyway.
  const persistedAttachmentCount = attachments.filter((a) => a.status === 'done' || a.status === 'uploading').length;
  const hasActiveUploads = attachments.some((a) => a.status === 'uploading');

  const insertAtCursor = useCallback((text) => {
    const ta = textareaRef.current;
    if (!ta) {
      setDescription((prev) => `${prev}${prev ? '\n' : ''}${text}`);
      return;
    }
    const start = ta.selectionStart ?? description.length;
    const end = ta.selectionEnd ?? description.length;
    const next = `${description.slice(0, start)}${text}${description.slice(end)}`;
    setDescription(next);
    // Schedule cursor restoration after React commits the new value.
    requestAnimationFrame(() => {
      const pos = start + text.length;
      ta.focus();
      ta.setSelectionRange(pos, pos);
    });
  }, [description]);

  const buildUploadCandidate = useCallback((file) => {
    // Local validation mirrors the server -- fail fast so the user gets a
    // toast before a 5 MB upload starts. Invalid files do NOT consume one of
    // the remaining per-task attachment slots.
    if (!file || typeof file.arrayBuffer !== 'function') return null;
    const name = deriveFileName(file);
    const kindLocal = classifyAttachment({ mime: file.type || '', name });
    if (!kindLocal) {
      showError({ message: t('errors.task_attachment_invalid_type'), detail_key: 'errors.task_attachment_invalid_type' });
      return null;
    }
    if (file.size > TASK_ATTACHMENT_MAX_BYTES) {
      showError({
        message: t('errors.task_attachment_too_large', {
          max_mb: Math.round(TASK_ATTACHMENT_MAX_BYTES / (1024 * 1024)),
        }),
        detail_key: 'errors.task_attachment_too_large',
      });
      return null;
    }
    return { file, name, kindLocal };
  }, [showError, t]);

  const startUpload = useCallback(async ({ file, name, kindLocal }, { insertMarkdown = false } = {}) => {
    const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const controller = new AbortController();
    uploadControllersRef.current.set(tempId, controller);
    setAttachments((prev) => [
      ...prev,
      {
        id: tempId,
        name,
        mime: file.type,
        size: file.size,
        kind: kindLocal,
        status: 'uploading',
      },
    ]);

    try {
      const att = await uploadTaskAttachment(projectId, {
        boardId,
        taskId: isExisting ? task.id : null,
        file: new File([file], name, { type: file.type }),
        signal: controller.signal,
      });
      // Race check: did the user remove the row while the POST was in
      // flight? AbortController can't always win; the server may have
      // committed the bytes before the abort signal landed. In that case,
      // the row is already off the UI and we owe a server-side cleanup.
      const resolution = await resolveInFlightUpload({
        tempId,
        uploadedId: att.id,
        cancelledIds: cancelledTempIdsRef.current,
        deleteFn: (id) => deleteTaskAttachment(projectId, id),
      });
      if (resolution === 'cancelled') return;
      sessionUploadIdsRef.current.push(att.id);
      setAttachments((prev) => prev.map((a) => (a.id === tempId ? { ...att, status: 'done' } : a)));
      if (insertMarkdown) {
        const md = att.kind === 'image'
          ? `![${att.name}](${att.url})`
          : `[${att.name}](${att.url})`;
        insertAtCursor(md);
      }
    } catch (err) {
      // AbortError from close() OR from per-row removal is a deliberate
      // cancel -- swallow silently. The remove handler already pulled the
      // row from state.
      if (err?.name === 'AbortError' || controller.signal.aborted) {
        cancelledTempIdsRef.current.delete(tempId);
        setAttachments((prev) => prev.filter((a) => a.id !== tempId));
        return;
      }
      setAttachments((prev) => prev.map((a) => (a.id === tempId ? { ...a, status: 'error' } : a)));
      showError(err);
    } finally {
      uploadControllersRef.current.delete(tempId);
    }
  }, [boardId, insertAtCursor, isExisting, projectId, showError, task?.id]);

  const queueFilesForUpload = useCallback((fileList, { insertMarkdown = false } = {}) => {
    const candidates = Array.from(fileList || [])
      .map((file) => buildUploadCandidate(file))
      .filter(Boolean);
    if (candidates.length === 0) return;

    const { accepted, rejectedCount } = splitUploadCandidatesByAvailableSlots(
      candidates,
      persistedAttachmentCount,
      TASK_ATTACHMENT_MAX_PER_TASK,
    );
    if (rejectedCount > 0) {
      showError({
        message: t('errors.task_attachment_limit', { max: TASK_ATTACHMENT_MAX_PER_TASK }),
        detail_key: 'errors.task_attachment_limit',
      });
    }
    for (const candidate of accepted) {
      startUpload(candidate, { insertMarkdown });
    }
  }, [buildUploadCandidate, persistedAttachmentCount, showError, startUpload, t]);

  function handleFilePick(e) {
    const list = e.target.files;
    if (!list) return;
    queueFilesForUpload(list);
    // Reset so re-selecting the same file fires onChange again.
    e.target.value = '';
  }

  function handleDragOver(e) {
    if (isBusy) return;
    e.preventDefault();
    setDragActive(true);
  }

  function handleDragLeave(e) {
    e.preventDefault();
    setDragActive(false);
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragActive(false);
    if (isBusy) return;
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    queueFilesForUpload(files);
  }

  // Ctrl+V on the textarea: if the clipboard carries files, swallow the
  // default text-paste behavior and upload each one instead. The textarea
  // still pastes normal text -- only the file branch is intercepted.
  function handleDescriptionPaste(e) {
    const items = e.clipboardData?.items || [];
    const files = [];
    for (const item of items) {
      if (item.kind === 'file') {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length === 0) return; // let the browser handle the text paste
    e.preventDefault();
    queueFilesForUpload(files, { insertMarkdown: true });
  }

  async function handleRemoveAttachment(att) {
    // Uploading row: abort the in-flight POST and mark the tempId so the
    // success branch of handleUpload tears down the attachment server-side
    // if the bytes happened to commit before the abort landed. The row is
    // pulled from state immediately for snappy UX.
    if (att.status === 'uploading') {
      const controller = uploadControllersRef.current.get(att.id);
      cancelledTempIdsRef.current.add(att.id);
      if (controller) {
        try { controller.abort(); } catch { /* ignore */ }
      }
      setAttachments((prev) => prev.filter((a) => a.id !== att.id));
      return;
    }
    // Errored row: never reached the server, just drop from state.
    if (att.status !== 'done') {
      setAttachments((prev) => prev.filter((a) => a.id !== att.id));
      return;
    }
    setAttachments((prev) => prev.filter((a) => a.id !== att.id));
    const consumed = consumeSessionUploadId(sessionUploadIdsRef.current, att.id);
    sessionUploadIdsRef.current = consumed.nextIds;
    if (consumed.consumed || !isExisting) {
      // Eagerly tear down uploads created by this modal session, even while
      // editing an existing task. They were never part of the saved task
      // payload before this modal opened, so save-time diffing will not delete
      // them if the user removes them before saving.
      try { await deleteTaskAttachment(projectId, att.id); } catch { /* logged elsewhere */ }
      return;
    }
    // For edit flow we DO NOT delete on remove-click; the deletion is deferred
    // to save (the server diffs and tears down at that moment). This matches
    // the plan: cancel-edit must not lose attachments the user removed but
    // didn't yet save.
  }

  async function cleanupSessionUploads() {
    const ids = sessionUploadIdsRef.current.slice();
    sessionUploadIdsRef.current = [];
    await cleanupOrphanUploads({
      submitted: submittedRef.current,
      ids,
      deleteFn: (id) => deleteTaskAttachment(projectId, id),
    });
  }

  async function handleClose() {
    if (isBusy) return;
    // Cancel any uploads still in flight in BOTH flows -- otherwise an
    // existing-task upload that wins the race after the modal closes would
    // become a permanent orphan (stamped to the task on the server, but
    // never reflected on the client's saved attachments[]).
    cancelInFlightUploads({
      controllers: uploadControllersRef.current,
      cancelledIds: cancelledTempIdsRef.current,
    });
    // Cleanup uploads done in this session whenever the user cancels --
    // both new-task AND existing-task flows. Anything the user uploaded here
    // but didn't save shouldn't linger as an orphan in the project index.
    // submittedRef gates this: a successful submit sets it true before the
    // parent unmounts the modal, so we never tear down the just-persisted
    // attachments even if a stray close fires during the unmount race.
    if (!submittedRef.current) await cleanupSessionUploads();
    onClose();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!title.trim()) return;
    if (hasActiveUploads) return;
    // Submit only the persisted attachments. Failed/uploading entries are
    // dropped so a half-finished upload can't be referenced by a saved task.
    const persisted = attachments
      .filter((a) => a.status === 'done')
      .map(({ status, ...rest }) => rest);
    try {
      await onSubmit({
        title: title.trim(),
        description,
        start_date: startDate || null,
        end_date: endDate || null,
        assignee: assignee.trim(),
        attachments: persisted,
      });
      // Only flip submittedRef AFTER the parent confirmed a successful save.
      // A rejected onSubmit (the parent's submitEditor re-throws after the
      // toast) leaves it false so a follow-up cancel still tears down the
      // session uploads.
      submittedRef.current = true;
    } catch {
      // Parent already toasted via showError; the modal stays open and the
      // user can either retry or cancel (which will now run cleanup).
    }
  }

  async function handleClearAssignee(name) {
    if (!onClearAssignee || clearingName) return;
    setClearingName(name);
    try {
      await onClearAssignee(name);
      if (assignee.trim().toLowerCase() === name.toLowerCase()) setAssignee('');
    } finally {
      setClearingName(null);
    }
  }

  function handleAssigneeSelect(value) {
    if (value === '__add__') {
      setAddingAssignee(true);
      setAssigneeDraft('');
      return;
    }
    setAssignee(value);
  }

  function commitAssignee() {
    setAssignee(assigneeDraft.trim());
    setAddingAssignee(false);
    setAssigneeDraft('');
  }

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: 'hsl(var(--overlay) / 0.6)' }}
      onMouseDown={handleClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-lg border p-5 shadow-xl"
        style={{ background: 'hsl(var(--card))', color: 'hsl(var(--foreground))', borderColor: 'hsl(var(--border))' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-semibold text-foreground">
            {isExisting ? t('tasks.editTask') : t('tasks.newTask')}
          </h3>
          <button
            type="button"
            onClick={handleClose}
            disabled={isBusy}
            className="text-muted-foreground hover:text-foreground disabled:opacity-50"
            aria-label={t('sidebar.close')}
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">{t('tasks.title')}</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={TASK_TITLE_MAX}
              autoFocus
              disabled={isBusy}
              className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          {/* Two-column layout on desktop: description+preview on the left,
              attachments toolbar on the right. Stacks below md so mobile
              keeps a single readable flow. */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="space-y-2">
              <label className="block text-xs text-muted-foreground">{t('tasks.description')}</label>
              <textarea
                ref={textareaRef}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onPaste={handleDescriptionPaste}
                maxLength={TASK_DESCRIPTION_MAX}
                rows={12}
                disabled={isBusy}
                placeholder={t('tasks.descriptionPlaceholder')}
                className="w-full resize-y rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <TaskMediaPreview description={description} attachments={attachments.filter((a) => a.status === 'done')} />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs text-muted-foreground">{t('tasks.attachments')}</label>
                <span className="text-[11px] text-muted-foreground">
                  {persistedAttachmentCount}/{TASK_ATTACHMENT_MAX_PER_TASK}
                </span>
              </div>
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`flex flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed px-3 py-4 text-center text-xs transition-colors ${
                  dragActive
                    ? 'border-primary/60 bg-primary/5'
                    : 'border-border bg-muted/20 hover:border-primary/40'
                }`}
              >
                <Upload size={18} className="text-muted-foreground" />
                <p className="text-muted-foreground">
                  {t('tasks.attachmentsDropHint')}
                </p>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isBusy}
                  className="mt-1 inline-flex items-center gap-1.5 rounded border border-border bg-card px-2 py-1 text-[11px] font-medium hover:border-primary/40 hover:text-primary disabled:opacity-50"
                >
                  <Paperclip size={11} />
                  {t('tasks.attachmentsPick')}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  hidden
                  onChange={handleFilePick}
                  accept="image/png,image/jpeg,image/gif,image/webp,image/avif,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
                />
              </div>
              {attachments.length > 0 && (
                <ul className="flex max-h-64 flex-col gap-1 overflow-auto rounded border border-border bg-muted/10 p-1.5">
                  {attachments.map((a) => (
                    <li
                      key={a.id}
                      className="flex items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-muted/30"
                    >
                      <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
                        {a.kind === 'image' ? <ImageIcon size={11} /> : <FileText size={11} />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium text-foreground" title={a.name}>{a.name}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {a.status === 'uploading' && (
                            <span className="inline-flex items-center gap-1">
                              <Loader size={10} className="animate-spin" />
                              {t('tasks.attachmentsUploading')}
                            </span>
                          )}
                          {a.status === 'error' && (
                            <span className="text-destructive">{t('tasks.attachmentsError')}</span>
                          )}
                          {a.status === 'done' && formatBytes(a.size)}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveAttachment(a)}
                        disabled={isBusy}
                        className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                        aria-label={t('tasks.attachmentsRemove')}
                        title={t('tasks.attachmentsRemove')}
                      >
                        <X size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">{t('tasks.startDate')}</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                disabled={isBusy}
                className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">{t('tasks.endDate')}</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                disabled={isBusy}
                className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="block text-xs text-muted-foreground">{t('tasks.assignee')}</label>
              {onClearAssignee && assigneeSelectOptions.length > 0 && (
                <button
                  type="button"
                  onClick={() => setManagingAssignees((v) => !v)}
                  disabled={isBusy}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-primary disabled:opacity-50"
                  title={t('tasks.manageAssignees')}
                >
                  <Settings2 size={12} />
                  {t('tasks.manageAssignees')}
                </button>
              )}
            </div>
            {addingAssignee ? (
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={assigneeDraft}
                  onChange={(e) => setAssigneeDraft(e.target.value)}
                  maxLength={TASK_ASSIGNEE_MAX}
                  autoFocus
                  placeholder={t('tasks.assigneePlaceholder')}
                  disabled={isBusy}
                  className="min-w-0 flex-1 rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <button
                  type="button"
                  onClick={commitAssignee}
                  disabled={isBusy}
                  className="rounded-md px-2 text-success hover:bg-muted/40 disabled:opacity-50"
                  title={t('tasks.save')}
                >
                  <Check size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => setAddingAssignee(false)}
                  disabled={isBusy}
                  className="rounded-md px-2 text-muted-foreground hover:bg-muted/40 hover:text-foreground disabled:opacity-50"
                  title={t('tasks.cancel')}
                >
                  <X size={15} />
                </button>
              </div>
            ) : (
              <select
                value={assignee}
                onChange={(e) => handleAssigneeSelect(e.target.value)}
                disabled={isBusy}
                className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">{t('tasks.noAssignee')}</option>
                {assigneeSelectOptions.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
                <option value="__add__">{t('tasks.addAssignee')}</option>
              </select>
            )}
            {managingAssignees && onClearAssignee && (
              <div
                className="mt-2 rounded-md border p-2"
                style={{ background: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }}
              >
                <p className="mb-2 text-[11px] text-muted-foreground">
                  {t('tasks.manageAssigneesHint')}
                </p>
                {assigneeSelectOptions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t('tasks.noAssignee')}</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {assigneeSelectOptions.map((name) => (
                      <li
                        key={name}
                        className="flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-muted/40"
                      >
                        <span className="min-w-0 flex-1 truncate">{name}</span>
                        <button
                          type="button"
                          onClick={() => handleClearAssignee(name)}
                          disabled={isBusy || clearingName === name}
                          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-destructive disabled:opacity-50"
                          title={t('tasks.removeAssignee')}
                        >
                          {clearingName === name
                            ? <Loader size={12} className="animate-spin" />
                            : <Trash2 size={12} />}
                          {t('tasks.removeAssignee')}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 pt-2">
            {isExisting && onDelete && (
              confirmingDelete ? (
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => onDelete()}
                  className="inline-flex items-center gap-1.5 rounded px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                  style={{ background: 'hsl(var(--destructive))' }}
                >
                  {deleting ? <Loader size={13} className="animate-spin" /> : <Trash2 size={13} />}
                  {t('tasks.delete')}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => setConfirmingDelete(true)}
                  className="inline-flex items-center gap-1.5 rounded px-3 py-2 text-sm text-muted-foreground hover:text-destructive disabled:opacity-50"
                >
                  <Trash2 size={13} />
                  {t('tasks.delete')}
                </button>
              )
            )}
            <div className="flex-1" />
            <button
              type="button"
              onClick={handleClose}
              disabled={isBusy}
              className="rounded border border-border px-3 py-2 text-sm hover:bg-muted/40 disabled:opacity-50"
            >
              {t('tasks.cancel')}
            </button>
            <button
              type="submit"
              disabled={isBusy || hasActiveUploads || !title.trim()}
              className="inline-flex items-center gap-1.5 rounded bg-brand-gradient px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading && <Loader size={13} className="animate-spin" />}
              {isExisting ? (loading ? t('tasks.saving') : t('tasks.save')) : (loading ? t('tasks.creating') : t('tasks.create'))}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
