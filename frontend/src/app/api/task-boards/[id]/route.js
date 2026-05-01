import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { withAuth } from '@/lib/auth';
import {
  readProjectFile,
  writeProjectFile,
  withProjectLock,
  validateGroupBelongsToProject,
} from '@/lib/projectStorage';
import {
  BOARD_NAME_MAX,
  COLUMN_TITLE_MAX,
  TASK_TITLE_MAX,
  TASK_DESCRIPTION_MAX,
  TASK_ASSIGNEE_MAX,
  TASK_ATTACHMENT_MAX_PER_TASK,
} from '@/lib/taskBoardsConfig';
import { normalizeBoards } from '@/lib/taskBoardsStore';
import {
  normalizePublicAttachments,
  stampAttachmentsForTask,
  deleteAttachmentCompletely,
  hydrateBoardsAttachments,
} from '@/lib/taskAttachments';
import { reorderById } from '@/utils/reorder';

const FILE = 'task-boards.json';
const EMPTY = { boards: [] };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function bad(detailKey, detail, status = 400, detailParams) {
  return NextResponse.json(
    { detail, detail_key: detailKey, detail_params: detailParams },
    { status },
  );
}

function getProjectId(req) {
  const url = new URL(req.url);
  return url.searchParams.get('project_id');
}

function appErr(key, message, { status = 400, params } = {}) {
  return Object.assign(new Error(message), { key, status, params });
}

function validateName(raw, { maxKey, requiredKey, max }) {
  if (typeof raw !== 'string') {
    throw appErr('errors.invalid_body', 'Invalid value');
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    throw appErr(requiredKey, 'Required');
  }
  if (trimmed.length > max) {
    throw appErr(maxKey, `Too long`, { params: { max } });
  }
  return trimmed;
}

function validateDate(raw, label) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw !== 'string' || !DATE_RE.test(raw)) {
    throw appErr('errors.task_invalid_date', `Invalid ${label}`);
  }
  // Ensure the date string represents a real calendar date (e.g. reject 2025-02-30).
  const [y, m, d] = raw.split('-').map((p) => Number(p));
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    throw appErr('errors.task_invalid_date', `Invalid ${label}`);
  }
  return raw;
}

function validateAssignee(raw) {
  if (raw === null || raw === undefined) return '';
  if (typeof raw !== 'string') throw appErr('errors.invalid_body', 'Invalid assignee');
  const trimmed = raw.trim();
  if (trimmed.length > TASK_ASSIGNEE_MAX) {
    throw appErr('errors.task_assignee_too_long', 'Assignee too long', { params: { max: TASK_ASSIGNEE_MAX } });
  }
  return trimmed;
}

function validateDescription(raw) {
  if (raw === null || raw === undefined) return '';
  if (typeof raw !== 'string') throw appErr('errors.invalid_body', 'Invalid description');
  if (raw.length > TASK_DESCRIPTION_MAX) {
    throw appErr('errors.task_description_too_long', 'Description too long', { params: { max: TASK_DESCRIPTION_MAX } });
  }
  return raw;
}

function validateDateRange(start, end) {
  if (start && end && end < start) {
    throw appErr('errors.task_invalid_date_range', 'End date must be on or after start date');
  }
}

function findBoard(boards, id) {
  const idx = boards.findIndex((b) => b.id === id);
  if (idx < 0) {
    throw appErr('errors.task_board_not_found', 'Board not found', { status: 404 });
  }
  return idx;
}

function findColumn(board, columnId) {
  const idx = board.columns.findIndex((c) => c.id === columnId);
  if (idx < 0) {
    throw appErr('errors.task_column_not_found', 'Column not found', { status: 404 });
  }
  return idx;
}

function findTask(board, taskId) {
  const idx = board.tasks.findIndex((t) => t.id === taskId);
  if (idx < 0) {
    throw appErr('errors.task_not_found', 'Task not found', { status: 404 });
  }
  return idx;
}

function validateAttachmentsInput(rawAttachments) {
  // attachments are optional on a payload; undefined signals "do not touch
  // existing". An explicit empty array is allowed and means "drop all".
  if (rawAttachments === undefined) return undefined;
  if (rawAttachments === null) return [];
  if (!Array.isArray(rawAttachments)) {
    throw appErr('errors.invalid_body', 'attachments must be an array');
  }
  if (rawAttachments.length > TASK_ATTACHMENT_MAX_PER_TASK) {
    throw appErr(
      'errors.task_attachment_limit',
      'Too many attachments on this task',
      { params: { max: TASK_ATTACHMENT_MAX_PER_TASK } },
    );
  }
  // We don't trust the client-sent `name/mime/...` here -- the index is the
  // authoritative source. But we still normalize so a malformed entry can't
  // poison disk state.
  return normalizePublicAttachments(rawAttachments);
}

function buildTaskFromInput(input, { now, existing = null }) {
  const title = validateName(input?.title ?? existing?.title, {
    requiredKey: 'errors.task_title_required',
    maxKey: 'errors.task_title_too_long',
    max: TASK_TITLE_MAX,
  });
  const description = input?.description !== undefined
    ? validateDescription(input.description)
    : (existing?.description ?? '');
  const startDate = input?.start_date !== undefined
    ? validateDate(input.start_date, 'start_date')
    : (existing?.start_date ?? null);
  const endDate = input?.end_date !== undefined
    ? validateDate(input.end_date, 'end_date')
    : (existing?.end_date ?? null);
  validateDateRange(startDate, endDate);
  const assignee = input?.assignee !== undefined
    ? validateAssignee(input.assignee)
    : (existing?.assignee ?? '');
  // attachments: undefined -> keep existing; array -> replace; null -> wipe.
  const inputAttachments = validateAttachmentsInput(input?.attachments);
  const attachments = inputAttachments !== undefined
    ? inputAttachments
    : (Array.isArray(existing?.attachments) ? existing.attachments : []);
  return {
    id: existing?.id || `task-${randomUUID()}`,
    title,
    description,
    start_date: startDate,
    end_date: endDate,
    assignee,
    attachments,
    created_at: existing?.created_at || now,
    updated_at: now,
  };
}

function applyAction(board, action, now) {
  if (!action || typeof action !== 'object') {
    throw appErr('errors.invalid_body', 'Invalid action');
  }
  const next = {
    ...board,
    columns: board.columns.map((c) => ({ ...c, task_ids: [...c.task_ids] })),
    tasks: board.tasks.map((t) => ({ ...t })),
  };

  switch (action.action) {
    case 'rename_board': {
      next.name = validateName(action.name, {
        requiredKey: 'errors.task_board_name_required',
        maxKey: 'errors.task_board_name_too_long',
        max: BOARD_NAME_MAX,
      });
      break;
    }
    case 'move_board_group': {
      const gid = action.group_id;
      if (gid === null || gid === undefined || gid === '') {
        next.group_id = null;
      } else if (typeof gid === 'string') {
        next.group_id = gid;
      } else {
        throw appErr('errors.invalid_body', 'Invalid group_id');
      }
      break;
    }
    case 'create_column': {
      const title = validateName(action.title, {
        requiredKey: 'errors.task_column_title_required',
        maxKey: 'errors.task_column_title_too_long',
        max: COLUMN_TITLE_MAX,
      });
      next.columns.push({
        id: `tcol-${randomUUID()}`,
        title,
        task_ids: [],
        created_at: now,
        updated_at: now,
      });
      break;
    }
    case 'rename_column': {
      const idx = findColumn(next, action.column_id);
      const title = validateName(action.title, {
        requiredKey: 'errors.task_column_title_required',
        maxKey: 'errors.task_column_title_too_long',
        max: COLUMN_TITLE_MAX,
      });
      next.columns[idx] = { ...next.columns[idx], title, updated_at: now };
      break;
    }
    case 'delete_column': {
      const idx = findColumn(next, action.column_id);
      if (next.columns[idx].task_ids.length > 0) {
        throw appErr('errors.task_column_not_empty', 'Column has tasks');
      }
      next.columns.splice(idx, 1);
      break;
    }
    case 'move_column': {
      const { active_id, over_id } = action;
      if (typeof active_id !== 'string' || typeof over_id !== 'string') {
        throw appErr('errors.invalid_body', 'Invalid move_column ids');
      }
      const reordered = reorderById(next.columns, active_id, over_id);
      next.columns = reordered;
      break;
    }
    case 'create_task': {
      const colIdx = findColumn(next, action.column_id);
      const created = buildTaskFromInput(action.task, { now });
      next.tasks.push(created);
      next.columns[colIdx].task_ids.push(created.id);
      next.columns[colIdx].updated_at = now;
      // Attachments uploaded with no task_id (new-task flow) get stamped to
      // this task here. Done outside the lock by the caller after we return.
      next._sideEffects = next._sideEffects || [];
      next._sideEffects.push({
        type: 'stamp_attachments',
        attachment_ids: created.attachments.map((a) => a.id),
        task_id: created.id,
      });
      break;
    }
    case 'update_task': {
      const taskIdx = findTask(next, action.task_id);
      const previous = next.tasks[taskIdx];
      const updated = buildTaskFromInput(action.task, { now, existing: previous });
      next.tasks[taskIdx] = updated;
      // Diff for attachment cleanup: anything present on `previous` but not
      // on `updated` is a user-initiated removal -- the binary + index entry
      // get torn down. The caller does this AFTER the file write commits so
      // a write failure doesn't leave the index inconsistent with the task.
      const previousIds = new Set((previous.attachments || []).map((a) => a.id));
      const updatedIds = new Set(updated.attachments.map((a) => a.id));
      const removedIds = [...previousIds].filter((id) => !updatedIds.has(id));
      const newIds = [...updatedIds].filter((id) => !previousIds.has(id));
      next._sideEffects = next._sideEffects || [];
      if (removedIds.length > 0) {
        next._sideEffects.push({ type: 'delete_attachments', attachment_ids: removedIds });
      }
      if (newIds.length > 0) {
        next._sideEffects.push({
          type: 'stamp_attachments',
          attachment_ids: newIds,
          task_id: updated.id,
        });
      }
      break;
    }
    case 'delete_task': {
      const taskIdx = findTask(next, action.task_id);
      const previous = next.tasks[taskIdx];
      const taskId = previous.id;
      next.tasks.splice(taskIdx, 1);
      next.columns = next.columns.map((c) => {
        if (!c.task_ids.includes(taskId)) return c;
        return {
          ...c,
          task_ids: c.task_ids.filter((tid) => tid !== taskId),
          updated_at: now,
        };
      });
      const ids = (previous.attachments || []).map((a) => a.id);
      if (ids.length > 0) {
        next._sideEffects = next._sideEffects || [];
        next._sideEffects.push({ type: 'delete_attachments', attachment_ids: ids });
      }
      break;
    }
    case 'move_task': {
      const { task_id, to_column_id, over_task_id } = action;
      if (typeof task_id !== 'string' || typeof to_column_id !== 'string') {
        throw appErr('errors.invalid_body', 'Invalid move_task');
      }
      findTask(next, task_id);
      const destIdx = findColumn(next, to_column_id);
      const sourceColumn = next.columns.find((c) => c.task_ids.includes(task_id));
      // Drop on self with same column → idempotent. Without this short-circuit
      // the strip-and-push below would silently bump the task to the bottom of
      // its own column.
      if (
        sourceColumn
        && sourceColumn.id === to_column_id
        && (
          !over_task_id
          || typeof over_task_id !== 'string'
          || over_task_id === task_id
        )
      ) {
        return board;
      }
      // Strip the task from every column first so a move can never duplicate it.
      next.columns = next.columns.map((c) => {
        if (!c.task_ids.includes(task_id)) return c;
        return {
          ...c,
          task_ids: c.task_ids.filter((tid) => tid !== task_id),
          updated_at: now,
        };
      });
      const destCol = { ...next.columns[destIdx], task_ids: [...next.columns[destIdx].task_ids] };
      if (over_task_id && typeof over_task_id === 'string' && over_task_id !== task_id) {
        const overIdx = destCol.task_ids.indexOf(over_task_id);
        if (overIdx >= 0) {
          destCol.task_ids.splice(overIdx, 0, task_id);
        } else {
          destCol.task_ids.push(task_id);
        }
      } else {
        destCol.task_ids.push(task_id);
      }
      destCol.updated_at = now;
      next.columns[destIdx] = destCol;
      break;
    }
    case 'bulk_clear_assignee': {
      // Remove a person's name from every task on this board. Used by the
      // editor's "manage assignees" UI when the user wants to retire a name
      // from the suggestion list (the list is derived from task data, so
      // clearing here makes the option vanish board-wide).
      const raw = action.assignee;
      if (typeof raw !== 'string') {
        throw appErr('errors.invalid_body', 'Invalid assignee');
      }
      const target = raw.trim().toLowerCase();
      if (!target) {
        throw appErr('errors.invalid_body', 'Empty assignee');
      }
      next.tasks = next.tasks.map((t) => {
        if (String(t.assignee || '').trim().toLowerCase() !== target) return t;
        return { ...t, assignee: '', updated_at: now };
      });
      break;
    }
    default:
      throw appErr('errors.invalid_body', 'Unknown action');
  }

  next.updated_at = now;
  return next;
}

// Inside-lock read + normalize. Boards on disk may have stale shape; normalize
// every time so action handlers see a well-formed state.
async function readNormalizedBoardsInsideLock(projectId) {
  const data = await readProjectFile(projectId, FILE, EMPTY);
  const { normalized } = normalizeBoards(data?.boards);
  return normalized;
}

export const PATCH = withAuth(async (req, { params }) => {
  const { id } = await params;
  const projectId = getProjectId(req);
  if (!projectId) {
    return bad('errors.invalid_body', 'project_id query param is required', 400);
  }
  let body;
  try {
    body = await req.json();
  } catch {
    return bad('errors.invalid_body', 'Invalid JSON');
  }

  // Cross-project group leak guard: when the action is `move_board_group`,
  // make sure the supplied group_id (if any) lives on this project's
  // groups file. Done outside the lock since the groups file is a separate
  // shard and we don't want to nest lock acquisitions.
  if (body && body.action === 'move_board_group') {
    const groupErr = await validateGroupBelongsToProject(projectId, 'task-board-groups.json', body.group_id ?? null);
    if (groupErr) return bad(groupErr.detailKey, groupErr.detail, 400, groupErr.params);
  }

  try {
    let sideEffects = [];
    const updated = await withProjectLock(projectId, FILE, async () => {
      const boards = await readNormalizedBoardsInsideLock(projectId);
      const idx = findBoard(boards, id);
      const now = new Date().toISOString();
      const next = applyAction(boards[idx], body, now);
      // applyAction parks attachment side-effects on next._sideEffects so we
      // can apply them (binary delete / index re-stamp) AFTER the file write
      // commits -- if the write throws, side-effects never run and the
      // attachment index stays consistent with what's on disk.
      sideEffects = Array.isArray(next._sideEffects) ? next._sideEffects : [];
      delete next._sideEffects;
      // Force-set project_id from URL so a stale or missing field on disk
      // never leaks across projects.
      next.project_id = projectId;
      boards[idx] = next;
      await writeProjectFile(projectId, FILE, { boards });
      return next;
    });

    // Side-effect pass. Failures here are logged but do not roll back the
    // task-boards write -- a stale attachment entry is recoverable on the
    // next project-delete cleanup, but a task that says it has an attachment
    // it doesn't is permanently confusing.
    for (const eff of sideEffects) {
      if (eff.type === 'delete_attachments') {
        for (const aid of eff.attachment_ids) {
          try { await deleteAttachmentCompletely(projectId, aid); }
          catch (err) {
            console.warn(`[task-boards] attachment cleanup failed for ${aid}: ${err?.message || err}`);
          }
        }
      } else if (eff.type === 'stamp_attachments') {
        try { await stampAttachmentsForTask(projectId, eff.attachment_ids, eff.task_id, id); }
        catch (err) {
          console.warn(`[task-boards] attachment stamp failed: ${err?.message || err}`);
        }
      }
    }

    // Hydrate attachments via the canonical project index so the response
    // carries full {name, mime, size, kind, url, created_at} even when the
    // task on disk stored only {id}. Reads task-attachments.json once.
    const [hydratedBoard] = await hydrateBoardsAttachments(projectId, [updated]);
    return NextResponse.json(hydratedBoard);
  } catch (err) {
    if (/unknown project/i.test(err?.message || '')) {
      return bad('errors.project_not_found', 'project not found', 404, { project_id: projectId });
    }
    return bad(err.key || 'errors.invalid_body', err.message, err.status || 400, err.params);
  }
});

export const DELETE = withAuth(async (req, { params }) => {
  const { id } = await params;
  const projectId = getProjectId(req);
  if (!projectId) {
    return bad('errors.invalid_body', 'project_id query param is required', 400);
  }

  try {
    let removed = false;
    let attachmentIds = [];
    await withProjectLock(projectId, FILE, async () => {
      const boards = await readNormalizedBoardsInsideLock(projectId);
      const target = boards.find((b) => b && b.id === id);
      if (!target) return;
      const next = boards.filter((b) => !(b && b.id === id));
      // Snapshot every attachment id on the board's tasks before the write
      // so the side-effect pass below has a stable list. Failures here are
      // logged but never roll back the board removal.
      attachmentIds = (target.tasks || []).flatMap((task) => (
        Array.isArray(task?.attachments)
          ? task.attachments.map((a) => a?.id).filter(Boolean)
          : []
      ));
      removed = true;
      await writeProjectFile(projectId, FILE, { boards: next });
    });
    if (!removed) {
      return bad('errors.task_board_not_found', 'Board not found', 404, { id });
    }
    // Side-effect pass: tear down attachments AFTER the board file commits.
    // A storage failure leaves orphan binaries in the index but the board
    // itself is gone -- project-delete cleanup is the safety net.
    for (const aid of attachmentIds) {
      try { await deleteAttachmentCompletely(projectId, aid); }
      catch (err) {
        console.warn(`[task-boards] attachment cleanup on board delete failed for ${aid}: ${err?.message || err}`);
      }
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (/unknown project/i.test(err?.message || '')) {
      return bad('errors.project_not_found', 'project not found', 404, { project_id: projectId });
    }
    return bad(err.key || 'errors.invalid_body', err.message, err.status || 400, err.params);
  }
});
