import {
  readStoreFromBackend,
  writeStoreToBackend,
  withStoreLockOnBackend,
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
