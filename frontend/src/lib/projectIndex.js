// Plan 4 (manifest-as-truth): aggregate per-backend projects-manifest.json
// files into a single virtual project list. Each backend keeps its own
// manifest at the storage root (`projects-manifest.json`), so two installs
// pointed at the same backend see the same project list automatically.
//
// resolveProjectStorage previously read local `data/projects.json` to map
// projectId -> backendId; in v4.2 that mapping is derived from manifest
// scans instead, removing the local "shadow list" as a source of truth.

import {
  getConfig,
  readStoreFromBackend,
  writeStoreToBackend,
  withStoreLockOnBackend,
} from './storage.js';

const MANIFEST_REL = 'projects-manifest.json';

// Read a single backend's manifest. Returns the projects array (possibly
// empty). Failures bubble up as null so callers can choose between
// surfacing the error and skipping the backend silently. Aggregation paths
// (listAllProjects) skip; explicit single-backend writers must surface.
async function readManifest(backendId) {
  try {
    const data = await readStoreFromBackend(backendId, MANIFEST_REL, { v: 1, projects: [] });
    return Array.isArray(data?.projects) ? data.projects : [];
  } catch {
    return null;
  }
}

// Aggregate every configured backend's manifest into a flat list, decorating
// each entry with `backend_id`. Backends that fail to read are skipped
// silently -- callers see the union of healthy backends. Order is
// config-order, which puts `local` first by convention.
export async function listAllProjects() {
  const cfg = await getConfig();
  const out = [];
  for (const backend of cfg.backends) {
    const projects = await readManifest(backend.id);
    if (projects === null) continue;
    for (const p of projects) {
      out.push({ ...p, backend_id: backend.id });
    }
  }
  return out;
}

// Find which backend owns a given projectId by scanning manifests. Returns
// the backend id or null. Scan order matches config order; `local` first.
export async function findProjectBackend(projectId) {
  const all = await listAllProjects();
  const hit = all.find((p) => p.id === projectId);
  return hit ? hit.backend_id : null;
}

// Add (or update) a project entry in a specific backend's manifest. Atomic
// via the backend's own lock primitive. Idempotent: a matching id triggers
// a name update, never a duplicate row. `created_at` is preserved on
// updates so reconciler runs can't accidentally rewrite history.
export async function addProjectToManifest(backendId, project) {
  await withStoreLockOnBackend(backendId, MANIFEST_REL, async () => {
    const data = await readStoreFromBackend(backendId, MANIFEST_REL, { v: 1, projects: [] });
    const projects = Array.isArray(data.projects) ? [...data.projects] : [];
    const now = new Date().toISOString();
    const idx = projects.findIndex((p) => p.id === project.id);
    if (idx >= 0) {
      const prev = projects[idx];
      projects[idx] = {
        ...prev,
        // Caller-provided fields win, but never blow away an older
        // created_at with a fresh timestamp.
        ...project,
        created_at: prev.created_at || project.created_at || now,
        updated_at: now,
      };
    } else {
      projects.push({
        id: project.id,
        name: project.name,
        created_at: project.created_at || now,
        updated_at: now,
      });
    }
    await writeStoreToBackend(backendId, MANIFEST_REL, { v: 1, projects });
  });
}

// Drop a project entry from a backend's manifest. No-op if the project is
// already absent.
export async function removeProjectFromManifest(backendId, projectId) {
  await withStoreLockOnBackend(backendId, MANIFEST_REL, async () => {
    const data = await readStoreFromBackend(backendId, MANIFEST_REL, { v: 1, projects: [] });
    const projects = Array.isArray(data.projects) ? data.projects : [];
    const next = projects.filter((p) => p.id !== projectId);
    await writeStoreToBackend(backendId, MANIFEST_REL, { v: 1, projects: next });
  });
}
