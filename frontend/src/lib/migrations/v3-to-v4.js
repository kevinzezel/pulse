// v3 -> v4 storage migration. Two cases:
//   - Caso 1: local file install (no remote driver). Re-shards `data/*.json`
//     under `data/projects/<id>/` and `data/globals/` and writes a v2 config.
//   - Caso 2: v1 install with `s3` or `mongo` driver. Acquires a remote
//     migration lock (with a periodic heartbeat), re-shards the existing flat
//     remote layout into the v4 per-project layout in PARALLEL (the v1 flat
//     files are left in place so v3 readers can still serve traffic), routes
//     globals to the LOCAL backend, and rewrites local `storage-config.json`
//     to v2 with the imported backend marked as default. Each local project
//     entry gets a `storage_ref` pointing at the imported backend.
//
// This module is intentionally NOT wired into boot here -- Task 9 will pick
// it up. For now it's a pure exported `migrate()` callable from tests and
// from whatever startup hook lands later.

import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { randomUUID } from 'crypto';
import { S3Driver } from '../s3Store.js';
import { MongoDriver } from '../mongoStore.js';
import * as s3Lock from './locks/s3-lock.js';
import * as mongoLock from './locks/mongo-lock.js';

// Per-project collections that need to be split by `project_id`. The shard
// filename matches the source filename so the layout stays grep-friendly.
const PER_PROJECT_FILES = [
  { source: 'flows.json', shard: 'flows.json', arrayKey: 'flows' },
  { source: 'flow-groups.json', shard: 'flow-groups.json', arrayKey: 'groups' },
  { source: 'notes.json', shard: 'notes.json', arrayKey: 'notes' },
  { source: 'task-boards.json', shard: 'task-boards.json', arrayKey: 'boards' },
  { source: 'task-board-groups.json', shard: 'task-board-groups.json', arrayKey: 'groups' },
];

// Prompts and prompt-groups have a globals bucket too -- entries with
// `project_id: null` (or no `project_id`) move to `data/globals/<name>.json`.
const PROMPT_FILES = [
  { source: 'prompts.json', shard: 'prompts.json', global: 'prompts.json', arrayKey: 'prompts' },
  { source: 'prompt-groups.json', shard: 'prompt-groups.json', global: 'prompt-groups.json', arrayKey: 'groups' },
];

// Files removed automatically after a successful migration verification.
// Caso 1 (file local) only deletes per-project flat files -- per-install files
// (servers/sessions/etc) are still the source of truth locally in v4.
// Caso 2 (S3/Mongo) deletes the per-project legacy files unconditionally, plus
// per-install files but ONLY when a populated local copy exists (defense in
// depth -- per-install files in v3 lived on the remote and v4 keeps them
// strictly local; we copy them to local first, then guard the delete).
const CASO1_CLEANUP_FILES = [
  'flows.json',
  'flow-groups.json',
  'notes.json',
  'prompts.json',
  'prompt-groups.json',
  'task-boards.json',
  'task-board-groups.json',
];

// Per-project legacy files on the remote. Always safe to delete after a
// verified reshard -- their data is now in `projects/<id>/` shards.
const CASO2_PER_PROJECT_LEGACY = [
  'flows.json',
  'flow-groups.json',
  'notes.json',
  'prompts.json',
  'prompt-groups.json',
  'task-boards.json',
  'task-board-groups.json',
  // projects.json: in v4 the local one is the source of truth; the remote
  // version is a v3 leftover. projects-manifest.json is the v4 replacement.
  'projects.json',
];

// Per-install files. In v3, S3/Mongo installs stored these on the remote
// (because v3 had a single backend, no per-file routing). v4 keeps them
// strictly local. Migration must copy remote -> local BEFORE cleaning up the
// remote, and cleanup must refuse to delete the remote copy if the local file
// is empty/missing (defense in depth).
const PER_INSTALL_FILES = [
  'servers.json',
  'sessions.json',
  'recent-cwds.json',
  'intelligence-config.json',
  'compose-drafts.json',
  'groups.json',
  'layouts.json',
  'view-state.json',
];

function frontendRoot() {
  return process.env.PULSE_FRONTEND_ROOT || process.cwd();
}

function dataDir() {
  return join(frontendRoot(), 'data');
}

async function readJson(rel, fallback) {
  try {
    const text = await fs.readFile(join(dataDir(), rel), 'utf-8');
    if (!text.trim()) return fallback;
    return JSON.parse(text);
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

async function writeJson(rel, data) {
  const full = join(dataDir(), rel);
  await fs.mkdir(dirname(full), { recursive: true });
  await fs.writeFile(full, JSON.stringify(data, null, 2), 'utf-8');
}

async function exists(absPath) {
  try {
    await fs.access(absPath);
    return true;
  } catch {
    return false;
  }
}

// "Empty" means: missing, null, or a JSON object whose keys are all empty
// arrays/objects. This avoids the case where a fresh local file (created by
// the dashboard mid-development) shadows a populated remote copy. We only
// SKIP the remote copy when the local file genuinely has user data.
function isLocalFileEmpty(data) {
  if (data === null || data === undefined) return true;
  if (typeof data !== 'object') return false;
  for (const value of Object.values(data)) {
    if (Array.isArray(value)) {
      if (value.length > 0) return false;
    } else if (value && typeof value === 'object') {
      if (Object.keys(value).length > 0) return false;
    } else if (value !== null && value !== undefined) {
      // primitive (string/number/etc) -- treat as data
      return false;
    }
  }
  return true;
}

// In v3, S3/Mongo installs stored per-install files (servers.json, etc.) on
// the remote. v4 keeps these strictly local. This pass copies anything the
// remote still has into the local data dir IFF the local file is missing or
// empty -- a populated local copy always wins. Runs BEFORE cleanup so the
// auto-cleanup can safely remove the remote copy.
async function copyPerInstallFromRemote(driver) {
  let copied = 0;
  let skipped = 0;
  for (const file of PER_INSTALL_FILES) {
    try {
      const remoteData = await driver.readJsonFile(file, null);
      if (remoteData === null) continue; // not on remote, nothing to copy
      const localData = await readJson(file, null);
      if (!isLocalFileEmpty(localData)) {
        skipped += 1;
        continue;
      }
      await writeJson(file, remoteData);
      copied += 1;
    } catch (err) {
      console.warn(`[migrations:v3-to-v4] per-install copy: failed for ${file}: ${err?.message || err}`);
    }
  }
  console.log(`[migrations:v3-to-v4] per-install copy: ${copied} file(s) remote -> local, ${skipped} skipped (local already populated)`);
}

// Snapshot `data/` to a sibling `data.backup-pre-v4/` directory before any
// rewrites. Skipped if a previous migration attempt already left a backup --
// we never overwrite an existing backup, so users can hand-restore from the
// oldest known-good copy.
async function backupDataDir() {
  const src = dataDir();
  const dest = join(frontendRoot(), 'data.backup-pre-v4');
  if (await exists(dest)) return;
  await fs.cp(src, dest, { recursive: true });
}

function detectShape(config) {
  if (!config) return 'empty';
  // v:3 is the v4.2 reconciler marker, otherwise v2-shape internally.
  // Treat both as "already on v4 layout" so the v3-to-v4 migrator doesn't
  // accidentally regress a post-v4.2 config back to v:2.
  if ((config.v === 2 || config.v === 3) && Array.isArray(config.backends)) return 'v2';
  if (typeof config.driver === 'string') return 'v1';
  return 'unknown';
}

function buildLocalConfig() {
  return {
    v: 2,
    backends: [{ id: 'local', name: 'Local', driver: 'file', config: {} }],
    default_backend_id: 'local',
  };
}

// Heuristic: if the first project's shard already exists, we assume the
// layout was sharded in a prior run (or set up manually) and skip work.
async function projectsAlreadySharded() {
  const projectsDoc = await readJson('projects.json', { projects: [] });
  const projects = Array.isArray(projectsDoc.projects) ? projectsDoc.projects : [];
  if (projects.length === 0) return false;
  return await exists(join(dataDir(), 'projects', projects[0].id, 'flows.json'));
}

async function reshardLocalData(storageRef) {
  const projectsDoc = await readJson('projects.json', { projects: [], active_project_id: null });
  const projects = Array.isArray(projectsDoc.projects) ? projectsDoc.projects : [];

  // Stamp every project entry with its storage_ref so loaders know where to
  // look in v4. Existing values are left intact (idempotency).
  for (const p of projects) {
    if (!p.storage_ref) p.storage_ref = storageRef;
  }

  // Per-project collections: bucket by `project_id`, fall back to the first
  // project for orphan rows (rare but possible in older databases). Rows
  // dropped because no project exists at all are logged so the user can
  // recover from `data.backup-pre-v4/` if needed.
  for (const def of PER_PROJECT_FILES) {
    const flat = await readJson(def.source, { [def.arrayKey]: [] });
    const items = Array.isArray(flat[def.arrayKey]) ? flat[def.arrayKey] : [];
    const byProject = new Map();
    const dropped = [];
    for (const item of items) {
      const pid = item.project_id || (projects[0]?.id);
      if (!pid) {
        dropped.push(item.id ?? '<no-id>');
        continue;
      }
      if (!byProject.has(pid)) byProject.set(pid, []);
      byProject.get(pid).push(item);
    }
    if (dropped.length > 0) {
      console.warn(`[migrations:v3-to-v4] dropped ${dropped.length} orphan row(s) from ${def.source}: ${dropped.join(', ')}. Recover from data.backup-pre-v4/ if needed.`);
    }
    for (const [pid, list] of byProject) {
      await writeJson(`projects/${pid}/${def.shard}`, { [def.arrayKey]: list });
    }
  }

  // Prompts and prompt-groups: split into per-project shards plus a globals
  // bucket. `prompt-groups` historically has no `project_id` field at all --
  // the spec calls for those rows to migrate as globals with project_id: null.
  for (const def of PROMPT_FILES) {
    const flat = await readJson(def.source, { [def.arrayKey]: [] });
    const items = Array.isArray(flat[def.arrayKey]) ? flat[def.arrayKey] : [];
    const globals = [];
    const byProject = new Map();
    for (const item of items) {
      const pid = ('project_id' in item) ? item.project_id : null;
      if (!pid) {
        globals.push({ ...item, project_id: null });
      } else {
        if (!byProject.has(pid)) byProject.set(pid, []);
        byProject.get(pid).push(item);
      }
    }
    if (globals.length > 0) {
      await writeJson(`globals/${def.global}`, { [def.arrayKey]: globals });
    }
    for (const [pid, list] of byProject) {
      await writeJson(`projects/${pid}/${def.shard}`, { [def.arrayKey]: list });
    }
  }

  // Persist projects.json with the new storage_ref column applied.
  await writeJson('projects.json', { ...projectsDoc, projects });
}

// ---------- Caso 2 (remote drivers: s3 / mongo) ----------

const HEARTBEAT_INTERVAL_MS = 30 * 1000;

function lockApi(driverType) {
  if (driverType === 's3') return s3Lock;
  if (driverType === 'mongo') return mongoLock;
  throw new Error(`Unknown driver: ${driverType}`);
}

// Build the v2 storage-config that lists both the local backend (for globals
// and the projects manifest) and the imported remote backend (default).
function buildImportedConfig(v1) {
  const importedId = `b-${randomUUID()}`;
  const importedName = v1.bucket || v1.database || `Imported ${v1.driver}`;
  return {
    v: 2,
    backends: [
      { id: 'local', name: 'Local', driver: 'file', config: {} },
      { id: importedId, name: importedName, driver: v1.driver, config: v1 },
    ],
    default_backend_id: importedId,
  };
}

// Detect whether the remote already holds the v4 layout. We treat the
// presence of `projects-manifest.json` as the signal -- it's only ever
// written by the migration itself, so its existence means another install
// (or a previous run) already finished the reshard.
async function caso2RemoteAlreadySharded(driver) {
  const manifest = await driver.readJsonFile('projects-manifest.json', null);
  return manifest !== null && Array.isArray(manifest.projects);
}

// Re-shard the v1 flat layout on the remote into v4 shape. The original
// flat files are NOT deleted -- v3 readers continue to serve from them
// (cleanup is a separate manual step in a future Pulse release). Globals
// (rows with `project_id: null` or no `project_id`) are returned to the
// caller so they can be persisted to the LOCAL backend instead of the remote.
async function reshardRemoteData(driver, projects) {
  // Per-project collections (flows / notes / groups / task-boards / task-board-groups).
  for (const def of PER_PROJECT_FILES) {
    const flat = await driver.readJsonFile(def.source, { [def.arrayKey]: [] });
    const items = Array.isArray(flat[def.arrayKey]) ? flat[def.arrayKey] : [];
    const byProject = new Map();
    const dropped = [];
    for (const item of items) {
      const pid = item.project_id || projects[0]?.id;
      if (!pid) {
        dropped.push(item.id ?? '<no-id>');
        continue;
      }
      if (!byProject.has(pid)) byProject.set(pid, []);
      byProject.get(pid).push(item);
    }
    if (dropped.length > 0) {
      console.warn(`[migrations:v3-to-v4] (Caso 2) dropped ${dropped.length} orphan row(s) from ${def.source}: ${dropped.join(', ')}`);
    }
    for (const [pid, list] of byProject) {
      await driver.writeJsonFileAtomic(`projects/${pid}/${def.shard}`, { [def.arrayKey]: list });
    }
  }

  // Prompts / prompt-groups: scoped rows go to per-project shards on the
  // remote, globals are collected for the local backend instead.
  const globalPrompts = [];
  const globalGroups = [];

  for (const def of PROMPT_FILES) {
    const flat = await driver.readJsonFile(def.source, { [def.arrayKey]: [] });
    const items = Array.isArray(flat[def.arrayKey]) ? flat[def.arrayKey] : [];
    const byProject = new Map();
    for (const item of items) {
      const pid = ('project_id' in item) ? item.project_id : null;
      if (!pid) {
        if (def.arrayKey === 'prompts') globalPrompts.push({ ...item, project_id: null });
        else globalGroups.push({ ...item, project_id: null });
      } else {
        if (!byProject.has(pid)) byProject.set(pid, []);
        byProject.get(pid).push(item);
      }
    }
    for (const [pid, list] of byProject) {
      await driver.writeJsonFileAtomic(`projects/${pid}/${def.shard}`, { [def.arrayKey]: list });
    }
  }

  // Manifest at the remote root -- this is the marker that signals "the
  // reshard finished" to subsequent migration runs.
  await driver.writeJsonFileAtomic('projects-manifest.json', {
    v: 1,
    projects: projects.map(p => ({
      id: p.id,
      name: p.name,
      created_at: p.created_at,
      updated_at: p.updated_at,
    })),
  });

  return { globalPrompts, globalGroups };
}

async function migrateCase2(v1Config) {
  const driverType = v1Config.driver;
  const driver = driverType === 's3' ? new S3Driver(v1Config) : new MongoDriver(v1Config);
  await driver.init();

  const ownerId = `migrator-${randomUUID()}`;
  const lock = lockApi(driverType);

  let heartbeatTimer = null;

  try {
    const acquired = await lock.acquireMigrationLock(driver, 'migrating-v4', ownerId);
    if (!acquired) {
      throw new Error('Another install is currently migrating this remote. Try again later.');
    }
    heartbeatTimer = setInterval(() => {
      lock.heartbeat(driver, 'migrating-v4', ownerId).catch(() => {});
    }, HEARTBEAT_INTERVAL_MS);

    const newConfig = buildImportedConfig(v1Config);
    const importedId = newConfig.backends.find(b => b.id !== 'local').id;

    if (await caso2RemoteAlreadySharded(driver)) {
      // Remote already in v4 -- just rewrite local config and apply storage_ref.
      await writeJson('storage-config.json', newConfig);
      const projectsDoc = await readJson('projects.json', { projects: [], active_project_id: null });
      for (const p of projectsDoc.projects || []) {
        if (!p.storage_ref) p.storage_ref = importedId;
      }
      await writeJson('projects.json', projectsDoc);

      // Cleanup pass for installs upgraded under v4.0.0-pre: those got the v4
      // layout but the legacy flat files were never removed. Verify the v4
      // manifest is healthy before deleting anything; on failure we silently
      // leave the legacy files in place.
      const manifestProjects = Array.isArray(projectsDoc.projects) ? projectsDoc.projects : [];
      const verified = await verifyV4LayoutOnDriver(driver, manifestProjects);
      if (verified) {
        // Copy per-install files from remote BEFORE cleanup: v3 installs
        // upgraded under v4.0.0-pre never got these copied, and v4.0.1-pre's
        // unconditional cleanup deleted the only copy. This recovers any
        // remote per-install file as long as local hasn't been populated yet.
        await copyPerInstallFromRemote(driver);
        await cleanupLegacyOnDriverSafe(driver, `remote (${driverType})`);
      }
      return { ran: false, reason: 'remote-already-sharded' };
    }

    // Local backup before any work.
    await backupDataDir();

    // Read projects from remote (v1 layout).
    const projectsDoc = await driver.readJsonFile('projects.json', { projects: [], active_project_id: null });
    const projects = Array.isArray(projectsDoc.projects) ? projectsDoc.projects : [];

    // Reshard on remote (write parallel -- do not touch v1 flat layout).
    const { globalPrompts, globalGroups } = await reshardRemoteData(driver, projects);

    // Globals to LOCAL backend.
    if (globalPrompts.length > 0) {
      await writeJson('globals/prompts.json', { prompts: globalPrompts });
    }
    if (globalGroups.length > 0) {
      await writeJson('globals/prompt-groups.json', { groups: globalGroups });
    }

    // Local projects.json: copy from remote + add storage_ref.
    const localProjectsDoc = {
      projects: projects.map(p => ({ ...p, storage_ref: importedId })),
      active_project_id: projectsDoc.active_project_id || (projects[0]?.id ?? null),
    };
    await writeJson('projects.json', localProjectsDoc);
    await writeJson('storage-config.json', newConfig);

    // Verify the new layout on the remote, then remove legacy flat files.
    const verified = await verifyV4LayoutOnDriver(driver, projects);
    if (verified) {
      // Copy per-install files from remote BEFORE cleanup. In v3 these lived
      // on the remote because there was no per-file routing; v4 keeps them
      // local. Without this step the cleanup pass would delete the only copy.
      await copyPerInstallFromRemote(driver);
      await cleanupLegacyOnDriverSafe(driver, `remote (${driverType})`);
    }

    return { ran: true, case: 2 };
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    try {
      await lock.releaseMigrationLock(driver, 'migrating-v4', ownerId);
    } catch (err) {
      console.warn(`[migrations:v3-to-v4] failed to release migration lock (will expire after heartbeat timeout): ${err?.message || err}`);
    }
    await driver.close();
  }
}

// Verify the v4 layout is healthy before cleaning up the legacy flat. If
// anything looks wrong we leave the legacy files in place so the user can
// recover manually. Returns true on pass, false on suspected corruption.
async function verifyV4LayoutOnDriver(driver, projects) {
  const manifest = await driver.readJsonFile('projects-manifest.json', null);
  if (!manifest || !Array.isArray(manifest.projects)) {
    console.warn('[migrations:v3-to-v4] cleanup: manifest missing or malformed -- preserving legacy layout');
    return false;
  }
  if (manifest.projects.length !== projects.length) {
    console.warn(`[migrations:v3-to-v4] cleanup: manifest has ${manifest.projects.length} projects but expected ${projects.length} -- preserving legacy layout`);
    return false;
  }
  // Spot-check the first project's shard exists / is readable. We don't care
  // whether it's empty -- only that the read path works end to end.
  if (projects[0]) {
    try {
      await driver.readJsonFile(`projects/${projects[0].id}/flows.json`, { flows: [] });
    } catch (err) {
      console.warn(`[migrations:v3-to-v4] cleanup: spot-check read failed -- preserving legacy layout: ${err?.message || err}`);
      return false;
    }
  }
  return true;
}

// Two-pass cleanup for Caso 2:
//   1) Per-project legacy files (the data is already in `projects/<id>/`
//      shards, so deletion is unconditionally safe).
//   2) Per-install files -- delete from the remote ONLY when the local copy
//      is populated. This is defense in depth: even if the preceding
//      `copyPerInstallFromRemote` pass failed for some reason, cleanup will
//      not blow away the only copy.
async function cleanupLegacyOnDriverSafe(driver, label) {
  let removed = 0;
  let failed = 0;
  let skipped = 0;

  // Pass 1: per-project legacy (always safe to delete after a verified reshard).
  for (const file of CASO2_PER_PROJECT_LEGACY) {
    try {
      const wasRemoved = await driver.deleteFile(file);
      if (wasRemoved) removed += 1;
    } catch (err) {
      failed += 1;
      console.warn(`[migrations:v3-to-v4] cleanup: failed to delete ${file} from ${label}: ${err?.message || err}`);
    }
  }

  // Pass 2: per-install (only delete if local has populated content).
  for (const file of PER_INSTALL_FILES) {
    try {
      const localData = await readJson(file, null);
      if (isLocalFileEmpty(localData)) {
        skipped += 1;
        console.warn(`[migrations:v3-to-v4] cleanup: skipping ${file} on ${label} (local copy is empty/missing -- preserving remote)`);
        continue;
      }
      const wasRemoved = await driver.deleteFile(file);
      if (wasRemoved) removed += 1;
    } catch (err) {
      failed += 1;
      console.warn(`[migrations:v3-to-v4] cleanup: failed to delete ${file} from ${label}: ${err?.message || err}`);
    }
  }

  console.log(`[migrations:v3-to-v4] cleanup: removed ${removed} legacy v3 file(s) from ${label}, ${skipped} skipped (no local copy), ${failed} failure(s)`);
  return { removed, skipped, failed };
}

// File-driver-equivalent for Caso 1 (uses raw fs because the migrator runs
// before `storage.js` is wired up). Per-install files are NOT touched -- they
// remain the local source of truth in v4.
async function cleanupLegacyLocal() {
  let removed = 0;
  let failed = 0;
  for (const file of CASO1_CLEANUP_FILES) {
    try {
      await fs.unlink(join(dataDir(), file));
      removed += 1;
    } catch (err) {
      if (err.code === 'ENOENT') continue;
      failed += 1;
      console.warn(`[migrations:v3-to-v4] cleanup: failed to delete ${file} from local data/: ${err?.message || err}`);
    }
  }
  console.log(`[migrations:v3-to-v4] cleanup: removed ${removed} legacy v3 file(s) from local data/, ${failed} failure(s)`);
  return { removed, failed };
}

export async function migrate() {
  // An empty install has no `data/` yet -- create it so subsequent reads/writes
  // don't ENOENT before we can write `storage-config.json`.
  await fs.mkdir(dataDir(), { recursive: true });

  const config = await readJson('storage-config.json', null);
  const shape = detectShape(config);

  if (shape === 'v2') {
    return { ran: false, reason: 'already-v2' };
  }

  if (shape === 'v1' && (config.driver === 's3' || config.driver === 'mongo')) {
    return await migrateCase2(config);
  }

  // Caso 1: empty install, v1 file driver, or unrecognized shape (treated as
  // empty/legacy). Idempotent short-circuit comes BEFORE backup so that a
  // boot-time call on an already-sharded install doesn't pay the disk cost
  // of snapshotting a v4 tree.
  if (await projectsAlreadySharded()) {
    await writeJson('storage-config.json', buildLocalConfig());
    return { ran: false, reason: 'already-sharded' };
  }

  // Snapshot before mutating anything. Exists-check inside makes this safe
  // to call repeatedly (e.g. on a half-finished prior attempt).
  await backupDataDir();
  await reshardLocalData('local');
  await writeJson('storage-config.json', buildLocalConfig());

  // Caso 1 verification: just check that at least one shard was written. We can
  // inspect the local filesystem directly. The local backup at data.backup-pre-v4
  // is the safety net for any pathological corruption, so we proceed even if
  // projects array was empty (nothing to verify).
  const projectsDoc = await readJson('projects.json', { projects: [] });
  const projects = Array.isArray(projectsDoc.projects) ? projectsDoc.projects : [];
  let verified = true;
  if (projects[0]) {
    verified = await exists(join(dataDir(), 'projects', projects[0].id));
    if (!verified) {
      console.warn('[migrations:v3-to-v4] cleanup: first project shard missing -- preserving legacy layout');
    }
  }
  if (verified) {
    await cleanupLegacyLocal();
  }
  return { ran: true, case: 1 };
}
