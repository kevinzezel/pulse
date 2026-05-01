// Task-attachments: index + binary persistence.
//
// Storage layout (per project):
//   data/projects/<projectId>/task-attachments.json   -- the index file
//   data/projects/<projectId>/attachments/<attId>/<safeName>  -- the bytes
//
// Index entry shape (server-only fields kept here, never echoed to clients):
//   { id, task_id, board_id, object_path, name, mime, size, kind, created_at }
//
// Public attachment shape (what task.attachments[] holds and what the
// frontend sees):
//   { id, name, mime, size, kind, url, created_at }
//
// `task_id` is null when the attachment was uploaded for a task that doesn't
// exist yet (the new-task editor flow). The api/task-boards routes update
// task_id on create_task / update_task so cleanup logic always knows which
// task each attachment belongs to.

import { randomUUID } from 'crypto';
import {
  readProjectFile,
  writeProjectFile,
  withProjectLock,
  writeProjectBinary,
  readProjectBinary,
  deleteProjectFile,
} from './projectStorage.js';
import { classifyAttachment } from './taskBoardsConfig.js';

export const ATTACHMENTS_INDEX_FILE = 'task-attachments.json';
export const ATTACHMENTS_INDEX_EMPTY = { attachments: [] };

// Replace anything outside [a-zA-Z0-9._-] with `_` and clip to 120 chars.
// The resulting name can never escape the attachment directory (no `/`, no
// `..`) so writeProjectBinary can compose paths safely. An empty / bad name
// after sanitization falls back to `file`.
export function sanitizeAttachmentName(name) {
  const raw = String(name || '').trim();
  if (!raw) return 'file';
  // Strip any directory portion (Windows backslashes too).
  const base = raw.split(/[\\/]/).pop() || 'file';
  const safe = base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  if (!safe || safe === '.' || safe === '..') return 'file';
  return safe;
}

export function attachmentObjectPath(attachmentId, safeName) {
  return `attachments/${attachmentId}/${safeName}`;
}

// Build the public-facing attachment object that gets stored on
// task.attachments[] and serialized back to the frontend.
export function publicAttachment(entry, projectId) {
  return {
    id: entry.id,
    name: entry.name,
    mime: entry.mime,
    size: entry.size,
    kind: entry.kind,
    url: `/api/task-attachments/${entry.id}/content?project_id=${encodeURIComponent(projectId)}`,
    created_at: entry.created_at,
  };
}

// Normalize a raw attachments[] field that came from disk or from a request
// body. Drops anything that doesn't look like a real entry. The frontend may
// hand us either full public shape (id, name, mime, size, kind, url,
// created_at) or just `{ id }` (during update_task we trust the server-side
// index for the rest), so we only require `id`.
export function normalizePublicAttachments(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a) => a && typeof a.id === 'string' && a.id)
    .map((a) => ({
      id: a.id,
      name: typeof a.name === 'string' ? a.name : '',
      mime: typeof a.mime === 'string' ? a.mime : '',
      size: Number.isFinite(a.size) ? a.size : 0,
      kind: a.kind === 'image' ? 'image' : 'document',
      url: typeof a.url === 'string' ? a.url : '',
      created_at: typeof a.created_at === 'string' ? a.created_at : new Date().toISOString(),
    }));
}

// Read+merge: returns public-shape attachments hydrated from the index for a
// given task. Used when serializing tasks back to the frontend so URLs always
// reflect the canonical project_id even if the task's stored array drifted.
export async function hydrateTaskAttachments(projectId, taskAttachments) {
  if (!Array.isArray(taskAttachments) || taskAttachments.length === 0) return [];
  const index = await readProjectFile(projectId, ATTACHMENTS_INDEX_FILE, ATTACHMENTS_INDEX_EMPTY);
  const entries = Array.isArray(index?.attachments) ? index.attachments : [];
  const byId = new Map(entries.map((e) => [e.id, e]));
  const out = [];
  for (const att of taskAttachments) {
    const entry = byId.get(att.id);
    if (entry) {
      out.push(publicAttachment(entry, projectId));
    } else {
      // Index lost the entry (e.g. manual edit, partial migration) -- keep
      // what the task remembers but the URL still points at our content
      // route, which will 404 cleanly.
      out.push(publicAttachment({
        id: att.id,
        name: att.name,
        mime: att.mime,
        size: att.size,
        kind: att.kind,
        created_at: att.created_at,
      }, projectId));
    }
  }
  return out;
}

// Locate an entry by id under the project's index. Returns null when not
// found. Cheap enough to read on each request -- the file is tiny relative
// to the binaries it tracks.
export async function findAttachmentEntry(projectId, attachmentId) {
  const index = await readProjectFile(projectId, ATTACHMENTS_INDEX_FILE, ATTACHMENTS_INDEX_EMPTY);
  const entries = Array.isArray(index?.attachments) ? index.attachments : [];
  return entries.find((e) => e?.id === attachmentId) || null;
}

// Add a new entry under the project's lock. Returns the inserted entry.
export async function addAttachmentEntry(projectId, entry) {
  return withProjectLock(projectId, ATTACHMENTS_INDEX_FILE, async () => {
    const fresh = await readProjectFile(projectId, ATTACHMENTS_INDEX_FILE, ATTACHMENTS_INDEX_EMPTY);
    const entries = Array.isArray(fresh?.attachments) ? [...fresh.attachments] : [];
    entries.push(entry);
    await writeProjectFile(projectId, ATTACHMENTS_INDEX_FILE, { attachments: entries });
    return entry;
  });
}

// Remove an entry by id. Returns the removed entry (so the caller can clean
// up the binary), or null if the id wasn't there.
export async function removeAttachmentEntry(projectId, attachmentId) {
  return withProjectLock(projectId, ATTACHMENTS_INDEX_FILE, async () => {
    const fresh = await readProjectFile(projectId, ATTACHMENTS_INDEX_FILE, ATTACHMENTS_INDEX_EMPTY);
    const entries = Array.isArray(fresh?.attachments) ? fresh.attachments : [];
    const idx = entries.findIndex((e) => e?.id === attachmentId);
    if (idx < 0) return null;
    const [removed] = [entries[idx]];
    const next = entries.filter((_, i) => i !== idx);
    await writeProjectFile(projectId, ATTACHMENTS_INDEX_FILE, { attachments: next });
    return removed;
  });
}

// Bulk re-stamp: assign every attachment in `attachmentIds` to the given
// task/board so cleanup logic (delete_task) can locate them later. Used after
// create_task and update_task. Idempotent for entries already pointing at the
// target task.
export async function stampAttachmentsForTask(projectId, attachmentIds, taskId, boardId) {
  if (!Array.isArray(attachmentIds) || attachmentIds.length === 0) return;
  const wanted = new Set(attachmentIds);
  await withProjectLock(projectId, ATTACHMENTS_INDEX_FILE, async () => {
    const fresh = await readProjectFile(projectId, ATTACHMENTS_INDEX_FILE, ATTACHMENTS_INDEX_EMPTY);
    const entries = Array.isArray(fresh?.attachments) ? fresh.attachments : [];
    let changed = false;
    const next = entries.map((e) => {
      if (!wanted.has(e?.id)) return e;
      if (e.task_id === taskId && e.board_id === boardId) return e;
      changed = true;
      return { ...e, task_id: taskId, board_id: boardId };
    });
    if (changed) {
      await writeProjectFile(projectId, ATTACHMENTS_INDEX_FILE, { attachments: next });
    }
  });
}

// Delete the binary AND the index entry. Best-effort on the binary -- a
// missing file is fine (idempotent), unrecoverable storage failure throws.
// Returns the entry that was removed, or null when nothing matched.
export async function deleteAttachmentCompletely(projectId, attachmentId) {
  const removed = await removeAttachmentEntry(projectId, attachmentId);
  if (!removed) return null;
  // Path stored in the index includes the safe filename; pass it directly to
  // deleteFile (which expects relative-to-project input).
  try {
    await deleteProjectFile(projectId, removed.object_path);
  } catch (err) {
    // Surface to logs but don't fail the API call -- the index is the source
    // of truth and we already removed the entry.
    console.warn(`[taskAttachments] binary delete failed for ${removed.id}: ${err?.message || err}`);
  }
  return removed;
}

// Build a fresh index entry from an upload. The route does the validation
// (size, type, project/task existence); this just shapes the row.
export function buildAttachmentEntry({ id, taskId, boardId, name, mime, size }) {
  const safeName = sanitizeAttachmentName(name);
  const attachmentId = id || `att-${randomUUID()}`;
  const kind = classifyAttachment({ mime, name }) || 'document';
  return {
    id: attachmentId,
    task_id: taskId || null,
    board_id: boardId || null,
    object_path: attachmentObjectPath(attachmentId, safeName),
    name: safeName,
    mime,
    size,
    kind,
    created_at: new Date().toISOString(),
  };
}

// Wrappers exported here so routes don't have to thread two modules.
export { writeProjectBinary, readProjectBinary };

// `cleanupOrphanUploads` lives in `taskAttachmentsCleanup.js` so it can be
// imported from React components (browser bundle) without dragging in this
// module's `projectStorage` -> `storage` -> `fs` transitive chain. Re-export
// here so server-side callers can keep importing from one place.
export { cleanupOrphanUploads } from './taskAttachmentsCleanup.js';

// Hydrate every task in `boards` so its `attachments[]` reflects the
// canonical project index. Reads `task-attachments.json` exactly once for the
// whole list, so a board with N tasks costs O(1) reads instead of O(N). Tasks
// that reference an attachment id missing from the index keep a fallback
// shape (the URL still hits the content route, which 404s cleanly) so a
// damaged index never crashes the response.
export async function hydrateBoardsAttachments(projectId, boards) {
  const list = Array.isArray(boards) ? boards : [];
  if (list.length === 0) return list;

  const index = await readProjectFile(projectId, ATTACHMENTS_INDEX_FILE, ATTACHMENTS_INDEX_EMPTY);
  const entries = Array.isArray(index?.attachments) ? index.attachments : [];
  const byId = new Map(entries.map((e) => [e.id, e]));

  return list.map((board) => {
    if (!board || !Array.isArray(board.tasks)) return board;
    return {
      ...board,
      tasks: board.tasks.map((task) => {
        if (!task || !Array.isArray(task.attachments) || task.attachments.length === 0) return task;
        const hydrated = task.attachments.map((att) => {
          const entry = byId.get(att.id);
          if (entry) return publicAttachment(entry, projectId);
          // Index lost the entry: keep what the task remembers and let the
          // content route 404 if the binary is also gone.
          return publicAttachment({
            id: att.id,
            name: att.name,
            mime: att.mime,
            size: att.size,
            kind: att.kind,
            created_at: att.created_at,
          }, projectId);
        });
        return { ...task, attachments: hydrated };
      }),
    };
  });
}
