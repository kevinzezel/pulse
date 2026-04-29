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
  if (config.v === 2 && Array.isArray(config.backends)) return 'v2';
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
  return { ran: true, case: 1 };
}
