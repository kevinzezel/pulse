import { randomUUID } from 'crypto';
import { readStore, writeStore, withStoreLock } from './storage.js';

export const TASK_BOARDS_REL = 'data/task-boards.json';
export const TASK_BOARDS_EMPTY = { boards: [], updated_at: null };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeDate(raw) {
  if (typeof raw !== 'string' || !DATE_RE.test(raw)) return null;
  const [year, month, day] = raw.split('-').map((part) => Number(part));
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    return null;
  }
  return raw;
}

function appendLegacyMediaLinks(description, imageUrl, videoUrl) {
  let next = typeof description === 'string' ? description : '';
  for (const url of [imageUrl, videoUrl]) {
    const clean = typeof url === 'string' ? url.trim() : '';
    if (!clean || next.includes(clean)) continue;
    next = next.trimEnd();
    next = next ? `${next}\n\n${clean}` : clean;
  }
  return next;
}

export function normalizeBoard(board) {
  const now = new Date().toISOString();
  const id = typeof board?.id === 'string' && board.id ? board.id : `tboard-${randomUUID()}`;
  const name = String(board?.name ?? '').trim();
  // The task-boards route always re-stamps `project_id` from the request URL
  // before serializing, so any value in `board?.project_id` is just a
  // legacy passthrough -- when the field is missing, we leave it absent
  // rather than inventing a default that doesn't map to a real backend.
  const projectId = (typeof board?.project_id === 'string' && board.project_id) ? board.project_id : null;
  const groupId = (typeof board?.group_id === 'string' && board.group_id) ? board.group_id : null;

  // Tasks come first so columns can prune stale task ids.
  const usedTaskIds = new Set();
  const tasks = Array.isArray(board?.tasks) ? board.tasks.map((t) => {
    let taskId = typeof t?.id === 'string' && t.id ? t.id : `task-${randomUUID()}`;
    if (usedTaskIds.has(taskId)) taskId = `task-${randomUUID()}`;
    usedTaskIds.add(taskId);
    const description = appendLegacyMediaLinks(t?.description, t?.image_url, t?.video_url);
    return {
      id: taskId,
      title: String(t?.title ?? '').trim(),
      description,
      start_date: normalizeDate(t?.start_date),
      end_date: normalizeDate(t?.end_date),
      assignee: typeof t?.assignee === 'string' ? t.assignee : '',
      created_at: t?.created_at || now,
      updated_at: t?.updated_at || now,
    };
  }) : [];
  const taskIds = new Set(tasks.map((t) => t.id));
  const assignedTaskIds = new Set();

  let columns = Array.isArray(board?.columns) ? board.columns.map((c) => ({
    id: typeof c?.id === 'string' && c.id ? c.id : `tcol-${randomUUID()}`,
    title: String(c?.title ?? '').trim(),
    task_ids: Array.isArray(c?.task_ids) ? c.task_ids.filter((tid) => {
      if (!taskIds.has(tid) || assignedTaskIds.has(tid)) return false;
      assignedTaskIds.add(tid);
      return true;
    }) : [],
    created_at: c?.created_at || now,
    updated_at: c?.updated_at || now,
  })) : [];

  // Orphan rescue: a task without a column slot lands in the first column —
  // or a fresh `Todo` if there are none — so the board is always renderable.
  const referencedTaskIds = new Set(columns.flatMap((c) => c.task_ids));
  const orphans = tasks.filter((t) => !referencedTaskIds.has(t.id)).map((t) => t.id);
  if (orphans.length > 0) {
    if (columns.length === 0) {
      columns = [{
        id: `tcol-${randomUUID()}`,
        title: 'Todo',
        task_ids: [],
        created_at: now,
        updated_at: now,
      }];
    }
    columns[0].task_ids = [...columns[0].task_ids, ...orphans];
    columns[0].updated_at = now;
  }

  return {
    id,
    name,
    project_id: projectId,
    group_id: groupId,
    columns,
    tasks,
    created_at: board?.created_at || now,
    updated_at: board?.updated_at || now,
  };
}

export function normalizeBoards(rawBoards) {
  const list = Array.isArray(rawBoards) ? rawBoards : [];
  const normalized = list.map(normalizeBoard);
  const changed = JSON.stringify(normalized) !== JSON.stringify(list);
  return { normalized, changed };
}

// Read + normalize. If anything had to change, regrab the file under the lock
// so we don't clobber a concurrent PATCH that landed between the read and our
// writeback.
export async function readAndMigrateBoards() {
  const data = await readStore(TASK_BOARDS_REL, TASK_BOARDS_EMPTY);
  const { normalized, changed } = normalizeBoards(data?.boards);
  if (changed) {
    await withStoreLock(TASK_BOARDS_REL, async () => {
      const fresh = await readStore(TASK_BOARDS_REL, TASK_BOARDS_EMPTY);
      const { normalized: freshNormalized, changed: stillChanged } = normalizeBoards(fresh?.boards);
      if (stillChanged) {
        await writeStore(TASK_BOARDS_REL, {
          boards: freshNormalized,
          updated_at: fresh?.updated_at ?? new Date().toISOString(),
        });
      }
    });
  }
  return { boards: normalized, updated_at: data?.updated_at ?? null };
}

// Used inside an existing lock to grab the freshest normalized state without
// triggering another lock acquisition.
export async function readNormalizedInsideLock() {
  const data = await readStore(TASK_BOARDS_REL, TASK_BOARDS_EMPTY);
  const { normalized } = normalizeBoards(data?.boards);
  return { boards: normalized, updated_at: data?.updated_at ?? null };
}
