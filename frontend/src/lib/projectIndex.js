// Plan 4 (manifest-as-truth): aggregate per-backend projects-manifest.json
// files into a single virtual project list. Each backend keeps its own
// manifest under `data/projects-manifest.json`, so two installs pointed at
// the same backend see the same project list automatically.
//
// Path detail: the rel path is `data/projects-manifest.json`. The S3 and
// Mongo drivers strip the leading `data/` so the resolved key is still
// `<prefix>/projects-manifest.json` -- collaborators inspecting the bucket
// see the same layout they always did. The file driver does NOT strip, so
// the manifest lives inside `<frontend_root>/data/` next to the rest of the
// app's data instead of polluting the install root (which is the bug 4.2.0/
// 4.3.0-pre shipped with).
//
// resolveProjectStorage previously read local `data/projects.json` to map
// projectId -> backendId; in v4.2 that mapping is derived from manifest
// scans instead, removing the local "shadow list" as a source of truth.

import { getDriverFor } from './storage.js';
import {
  getConfig,
  readStoreFromBackend,
  writeStoreToBackend,
  withStoreLockOnBackend,
} from './storage.js';

const MANIFEST_REL = 'data/projects-manifest.json';
// File-driver pre-4.2.1 wrote the manifest at the install root (no `data/`
// prefix). Self-heal kicks in on first read of MANIFEST_REL: if the new
// path is empty/missing AND the legacy file exists, move it. Idempotent
// after the first call. S3/Mongo strip `data/` on resolution so they
// always landed at the same key -- no migration needed there.
const MANIFEST_REL_LEGACY_PRE_421 = 'projects-manifest.json';
let _legacyMigrationDone = false;

// One-shot self-heal for installs that wrote the manifest at the legacy
// pre-4.2.1 path (`<frontend_root>/projects-manifest.json` instead of
// `<frontend_root>/data/projects-manifest.json`). Only the local file
// driver was affected -- the S3/Mongo drivers strip `data/` on resolution
// so the on-disk key never moved. Sentinel value uses null instead of an
// empty `{ projects: [] }` so we can distinguish "absent" from "present
// but empty".
async function maybeMigrateLegacyLocalManifest() {
  if (_legacyMigrationDone) return;
  _legacyMigrationDone = true;
  try {
    const driver = await getDriverFor('local');
    const fresh = await driver.readJsonFile(MANIFEST_REL, null);
    if (fresh) return;
    const legacy = await driver.readJsonFile(MANIFEST_REL_LEGACY_PRE_421, null);
    if (!legacy || !Array.isArray(legacy?.projects)) return;
    await driver.writeJsonFileAtomic(MANIFEST_REL, legacy);
    if (typeof driver.deleteFile === 'function') {
      try { await driver.deleteFile(MANIFEST_REL_LEGACY_PRE_421); } catch {}
    }
    console.log('[projectIndex] migrated legacy local manifest to data/ subdir');
  } catch (err) {
    // Non-fatal: leave the flag flipped so we don't loop on a bad backend,
    // but log so users can diagnose. The manifest write on next project
    // creation will land at the correct path regardless.
    console.warn('[projectIndex] legacy manifest migration check failed:', err?.message || err);
  }
}

// Read a single backend's manifest. Returns the projects array (possibly
// empty). Failures bubble up as null so callers can choose between
// surfacing the error and skipping the backend silently. Aggregation paths
// (listAllProjects) skip; explicit single-backend writers must surface.
async function readManifest(backendId) {
  if (backendId === 'local') await maybeMigrateLegacyLocalManifest();
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
  if (backendId === 'local') await maybeMigrateLegacyLocalManifest();
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
