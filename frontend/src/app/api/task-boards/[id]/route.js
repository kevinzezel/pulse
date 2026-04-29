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
} from '@/lib/taskBoardsConfig';
import { normalizeBoards } from '@/lib/taskBoardsStore';
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
  return {
    id: existing?.id || `task-${randomUUID()}`,
    title,
    description,
    start_date: startDate,
    end_date: endDate,
    assignee,
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
      break;
    }
    case 'update_task': {
      const taskIdx = findTask(next, action.task_id);
      const updated = buildTaskFromInput(action.task, { now, existing: next.tasks[taskIdx] });
      next.tasks[taskIdx] = updated;
      break;
    }
    case 'delete_task': {
      const taskIdx = findTask(next, action.task_id);
      const taskId = next.tasks[taskIdx].id;
      next.tasks.splice(taskIdx, 1);
      next.columns = next.columns.map((c) => {
        if (!c.task_ids.includes(taskId)) return c;
        return {
          ...c,
          task_ids: c.task_ids.filter((tid) => tid !== taskId),
          updated_at: now,
        };
      });
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
    const updated = await withProjectLock(projectId, FILE, async () => {
      const boards = await readNormalizedBoardsInsideLock(projectId);
      const idx = findBoard(boards, id);
      const now = new Date().toISOString();
      const next = applyAction(boards[idx], body, now);
      // Force-set project_id from URL so a stale or missing field on disk
      // never leaks across projects.
      next.project_id = projectId;
      boards[idx] = next;
      await writeProjectFile(projectId, FILE, { boards });
      return next;
    });
    return NextResponse.json(updated);
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
    await withProjectLock(projectId, FILE, async () => {
      const boards = await readNormalizedBoardsInsideLock(projectId);
      const next = boards.filter((b) => !(b && b.id === id));
      if (next.length === boards.length) return;
      removed = true;
      await writeProjectFile(projectId, FILE, { boards: next });
    });
    if (!removed) {
      return bad('errors.task_board_not_found', 'Board not found', 404, { id });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (/unknown project/i.test(err?.message || '')) {
      return bad('errors.project_not_found', 'project not found', 404, { project_id: projectId });
    }
    return bad(err.key || 'errors.invalid_body', err.message, err.status || 400, err.params);
  }
});
