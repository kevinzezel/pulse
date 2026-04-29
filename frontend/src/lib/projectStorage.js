import {
  readStoreFromBackend,
  writeStoreToBackend,
  withStoreLockOnBackend,
  getDriverFor,
} from './storage.js';

const LOCAL_BACKEND_ID = 'local';

// projects.json is always stored on the local backend, even when the default
// backend is remote (a user with S3 default still has projects.json local).
// The path follows the existing storage convention: relPaths are anchored at
// PULSE_FRONTEND_ROOT, so user-data files live under `data/...`.
const PROJECTS_RELPATH = 'data/projects.json';

// Resolves a `project_id` to its storage backend id by reading the local
// projects.json. Throws if the project doesn't exist locally.
export async function resolveProjectStorage(projectId) {
  if (typeof projectId !== 'string' || !projectId) {
    throw new Error('resolveProjectStorage: projectId is required');
  }
  const driver = await getDriverFor(LOCAL_BACKEND_ID);
  const projectsDoc = await driver.readJsonFile(PROJECTS_RELPATH, { projects: [] });
  const projects = Array.isArray(projectsDoc.projects) ? projectsDoc.projects : [];
  const entry = projects.find((p) => p.id === projectId);
  if (!entry) {
    throw new Error(`unknown project: ${projectId}`);
  }
  return entry.storage_ref || LOCAL_BACKEND_ID;
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
