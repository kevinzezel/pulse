import {
  readStoreFromBackend,
  writeStoreToBackend,
  withStoreLockOnBackend,
  getDriverFor,
} from './storage.js';
import { findProjectBackend } from './projectIndex.js';

const LOCAL_BACKEND_ID = 'local';

// Plan 4 (manifest-as-truth): the projectId -> backendId mapping comes from
// scanning each backend's `projects-manifest.json` rather than the
// (now-defunct) local `data/projects.json`. The manifest scan happens
// inside `findProjectBackend`, which short-circuits as soon as it finds a
// match.
export async function resolveProjectStorage(projectId) {
  if (typeof projectId !== 'string' || !projectId) {
    throw new Error('resolveProjectStorage: projectId is required');
  }
  const backendId = await findProjectBackend(projectId);
  if (!backendId) {
    throw new Error(`unknown project: ${projectId}`);
  }
  return backendId;
}

function projectPath(projectId, file) {
  return `data/projects/${projectId}/${file}`;
}

function globalPath(file) {
  return `data/globals/${file}`;
}

export function recordBelongsToProject(record, projectId) {
  return Boolean(
    record
    && (
      typeof record.project_id !== 'string'
      || !record.project_id
      || record.project_id === projectId
    ),
  );
}

export function stampProjectRecords(records, projectId) {
  return (Array.isArray(records) ? records : [])
    .filter((record) => recordBelongsToProject(record, projectId))
    .map((record) => ({ ...record, project_id: projectId }));
}

// Sanity check used by per-project routes that accept a `group_id` body
// field: makes sure the supplied id is null/empty OR points at a group
// inside the project's matching groups file. Without this check the
// frontend can race a project switch and POST a `group_id` that belongs to
// the previous project (the dropdown showed stale entries while the new
// project's data was still in flight). Returns null on success; on
// mismatch returns a NextResponse-ready { detailKey, detail, params } so
// callers can stay in their own bad() helper. Pass `groupsFile` matching
// the route, e.g. `'task-board-groups.json'` or `'flow-groups.json'`.
export async function validateGroupBelongsToProject(projectId, groupsFile, groupId) {
  if (groupId === null || groupId === undefined || groupId === '') return null;
  if (typeof groupId !== 'string') {
    return { detailKey: 'errors.invalid_body', detail: 'group_id must be a string', params: { group_id: groupId } };
  }
  const data = await readProjectFile(projectId, groupsFile, { groups: [] });
  const groups = Array.isArray(data?.groups) ? data.groups : [];
  if (!groups.some((g) => g && g.id === groupId && recordBelongsToProject(g, projectId))) {
    return {
      detailKey: 'errors.group_not_in_project',
      detail: 'group does not belong to this project',
      params: { group_id: groupId, project_id: projectId },
    };
  }
  return null;
}

// ---------- Per-project file operations (route via storage_ref) ----------

export async function readProjectFile(projectId, file, fallback) {
  const backendId = await resolveProjectStorage(projectId);
  return readStoreFromBackend(backendId, projectPath(projectId, file), fallback);
}

export async function writeProjectFile(projectId, file, data) {
  const backendId = await resolveProjectStorage(projectId);
  return writeStoreToBackend(backendId, projectPath(projectId, file), data);
}

export async function withProjectLock(projectId, file, mutator) {
  const backendId = await resolveProjectStorage(projectId);
  return withStoreLockOnBackend(backendId, projectPath(projectId, file), mutator);
}

// ---------- Per-project binary operations (used by task-attachments) ----------
//
// `relPath` is interpreted relative to the project root (e.g.
// "attachments/att-uuid/photo.png"). The driver receives the full
// "data/projects/<id>/<relPath>" path so the bucket/file layout matches the
// JSON shards next to it.

export async function writeProjectBinary(projectId, relPath, buffer, opts = {}) {
  const backendId = await resolveProjectStorage(projectId);
  const driver = await getDriverFor(backendId);
  return driver.writeBinaryFileAtomic(projectPath(projectId, relPath), buffer, opts);
}

export async function readProjectBinary(projectId, relPath) {
  const backendId = await resolveProjectStorage(projectId);
  const driver = await getDriverFor(backendId);
  return driver.readBinaryFile(projectPath(projectId, relPath));
}

export async function deleteProjectFile(projectId, relPath) {
  const backendId = await resolveProjectStorage(projectId);
  const driver = await getDriverFor(backendId);
  if (typeof driver.deleteFile !== 'function') return false;
  return driver.deleteFile(projectPath(projectId, relPath));
}

// Best-effort recursive cleanup. Used by project-delete to remove an entire
// attachments tree without iterating each file. Drivers without
// `deletePrefix` (none today, but kept for forward compat) get a silent no-op
// so the caller can layer this on without runtime checks.
export async function deleteProjectPrefix(projectId, relPath) {
  const backendId = await resolveProjectStorage(projectId);
  const driver = await getDriverFor(backendId);
  if (typeof driver.deletePrefix !== 'function') return false;
  return driver.deletePrefix(projectPath(projectId, relPath));
}

// ---------- Global file operations (always go to local backend) ----------

export async function readGlobalFile(file, fallback) {
  return readStoreFromBackend(LOCAL_BACKEND_ID, globalPath(file), fallback);
}

export async function writeGlobalFile(file, data) {
  return writeStoreToBackend(LOCAL_BACKEND_ID, globalPath(file), data);
}

export async function withGlobalLock(file, mutator) {
  return withStoreLockOnBackend(LOCAL_BACKEND_ID, globalPath(file), mutator);
}

// ---------- Per-install operations (always route to backend 'local') ----------
//
// Used by routes that handle data that must NEVER travel to remote backends:
// projects.json (local lookup of projects + storage_ref), servers.json,
// sessions.json, recent-cwds.json, intelligence-config.json,
// compose-drafts.json, and groups.json (terminal groups). These all live in
// `<frontend_root>/data/<file>` regardless of what the default backend is.
//
// The legacy `storage.js` compat layer (readStore/writeStore) routes to the
// default backend, so a v4 install with S3 as default would (incorrectly)
// store these per-install files on S3. These helpers route explicitly to
// the `local` backend instead.

export async function readLocalStore(relPath, fallback) {
  return readStoreFromBackend(LOCAL_BACKEND_ID, relPath, fallback);
}

export async function writeLocalStore(relPath, data) {
  return writeStoreToBackend(LOCAL_BACKEND_ID, relPath, data);
}

export async function withLocalStoreLock(relPath, mutator) {
  return withStoreLockOnBackend(LOCAL_BACKEND_ID, relPath, mutator);
}
