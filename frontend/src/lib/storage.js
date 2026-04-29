import { promises as fs } from 'fs';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';
import { FileDriver } from './jsonStore.js';
import { S3Driver } from './s3Store.js';
import { MongoDriver } from './mongoStore.js';
import * as fileStoreLegacy from './jsonStore.js';
import * as s3StoreLegacy from './s3Store.js';
import * as mongoStoreLegacy from './mongoStore.js';
import { ensureMigrationsApplied, _resetMigrationsForTests } from './migrations/index.js';

const FRONTEND_ROOT = process.env.PULSE_FRONTEND_ROOT || process.cwd();
const CONFIG_PATH = join(FRONTEND_ROOT, 'data', 'storage-config.json');
const LEGACY_MONGO_CONFIG_PATH = join(FRONTEND_ROOT, 'data', 'mongo-config.json');
const DEFAULT_MONGO_DATABASE = 'pulse';

// 10s grace period for in-flight requests using the old client to complete
// before the connection is closed during a hot-reload. Picked as a ceiling
// well above any normal op latency but low enough to release native
// resources promptly. Bump if you see abrupt-close errors in logs.
const OLD_BACKEND_DRAIN_MS = 10000;

// Supported driver identifiers. Kept in one place so UI / validation /
// persistence stay in sync.
export const DRIVERS = Object.freeze(['file', 'mongo', 's3']);

// Driver factory registry — Plan 2 routes will pick a backend by id and
// instantiate the right class via this map.
const DRIVER_FACTORIES = {
  file: (config) => new FileDriver(config),
  s3: (config) => new S3Driver(config),
  mongo: (config) => new MongoDriver(config),
};

const DEFAULT_LOCAL_BACKEND = Object.freeze({
  id: 'local',
  name: 'Local',
  driver: 'file',
  config: {},
});

let _config = null;
let _configReadPromise = null;
const _driverPromises = new Map();
let _reloadPromise = null;

// ---------- v1 normalization (preserved for back-compat reads / UI shape) ----------

function normalizeMongoParams(raw) {
  const uri = typeof raw?.uri === 'string' ? raw.uri.trim() : '';
  if (!uri) return null;
  const database = typeof raw?.database === 'string' && raw.database.trim()
    ? raw.database.trim()
    : DEFAULT_MONGO_DATABASE;
  return { uri, database };
}

function normalizeS3Params(raw) {
  const bucket = typeof raw?.bucket === 'string' ? raw.bucket.trim() : '';
  const accessKeyId = typeof raw?.access_key_id === 'string' ? raw.access_key_id.trim() : '';
  const secretAccessKey = typeof raw?.secret_access_key === 'string' ? raw.secret_access_key : '';
  if (!bucket || !accessKeyId || !secretAccessKey) return null;
  return {
    endpoint: typeof raw?.endpoint === 'string' && raw.endpoint.trim() ? raw.endpoint.trim() : '',
    bucket,
    region: typeof raw?.region === 'string' && raw.region.trim() ? raw.region.trim() : 'us-east-1',
    access_key_id: accessKeyId,
    secret_access_key: secretAccessKey,
    prefix: typeof raw?.prefix === 'string' ? raw.prefix.trim() : '',
    force_path_style: raw?.force_path_style === true,
  };
}

// Turn a raw object into a valid v1 storage config, or null if invalid.
// File driver has no params; returning null signals "no remote config".
function normalizeV1Config(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const driver = typeof raw.driver === 'string' ? raw.driver : null;
  if (driver === 'mongo') {
    const params = normalizeMongoParams(raw);
    return params ? { driver: 'mongo', ...params } : null;
  }
  if (driver === 's3') {
    const params = normalizeS3Params(raw);
    return params ? { driver: 's3', ...params } : null;
  }
  // Legacy shape: no `driver` key, just { uri, database } → implicitly mongo.
  if (!driver && typeof raw.uri === 'string') {
    const params = normalizeMongoParams(raw);
    return params ? { driver: 'mongo', ...params } : null;
  }
  return null;
}

// ---------- v2 in-memory schema ----------

function emptyV2Config() {
  return {
    v: 2,
    backends: [{ ...DEFAULT_LOCAL_BACKEND }],
    default_backend_id: 'local',
  };
}

// Wrap a raw v1 config object as a v2 backends list. Adds the local fallback
// alongside the imported (remote) backend, which becomes the default.
function _wrapV1AsV2(v1) {
  const cfg = emptyV2Config();
  if (!v1 || !v1.driver || v1.driver === 'file') return cfg;
  const importedId = `b-${randomUUID()}`;
  const importedName = v1.bucket || v1.database || `Imported ${v1.driver}`;
  cfg.backends.push({
    id: importedId,
    name: importedName,
    driver: v1.driver,
    config: v1,
  });
  cfg.default_backend_id = importedId;
  return cfg;
}

async function _readConfigFromDisk() {
  try {
    const text = await fs.readFile(CONFIG_PATH, 'utf-8');
    if (!text.trim()) return emptyV2Config();
    const parsed = JSON.parse(text);
    if (parsed && (parsed.v === 2 || parsed.v === 3) && Array.isArray(parsed.backends)) {
      // v:3 is the v4.2 reconciler marker -- same v2 shape internally, just
      // signals "manifest reconciliation has happened". Reader treats them
      // identically; only the migrator cares about the distinction.
      // Defensive: ensure 'local' backend always exists and default is set.
      if (!parsed.backends.find((b) => b.id === 'local')) {
        parsed.backends.unshift({ ...DEFAULT_LOCAL_BACKEND });
      }
      if (!parsed.default_backend_id) parsed.default_backend_id = 'local';
      return parsed;
    }
    // v1 on disk — wrap it for in-memory use without rewriting.
    const normalized = normalizeV1Config(parsed);
    return _wrapV1AsV2(normalized);
  } catch (err) {
    if (err?.code === 'ENOENT') {
      // Fall through to legacy mongo-config.json migration.
      try {
        const legacy = await fs.readFile(LEGACY_MONGO_CONFIG_PATH, 'utf-8');
        const parsed = JSON.parse(legacy);
        const normalized = normalizeMongoParams(parsed);
        if (!normalized) return emptyV2Config();
        const v1 = { driver: 'mongo', ...normalized };
        // Migrate: write v1 shape to the new path, remove the old file.
        try {
          await _writeV1ToDisk(v1);
          try { await fs.unlink(LEGACY_MONGO_CONFIG_PATH); } catch {}
        } catch (writeErr) {
          console.error('[storage] legacy mongo-config.json migration failed:', writeErr);
        }
        return _wrapV1AsV2(v1);
      } catch (legacyErr) {
        if (legacyErr?.code === 'ENOENT') return emptyV2Config();
        throw legacyErr;
      }
    }
    throw err;
  }
}

// Atomic write of a v1-shaped storage config (current on-disk format).
// Used by writeConfig() and migration. Tasks 7/8 will switch to v2 on disk.
async function _writeV1ToDisk(v1) {
  await fs.mkdir(dirname(CONFIG_PATH), { recursive: true });
  const payload = { ...v1, updated_at: new Date().toISOString() };
  const tmp = `${CONFIG_PATH}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(payload, null, 2), 'utf-8');
    await fs.rename(tmp, CONFIG_PATH);
  } catch (err) {
    try { await fs.unlink(tmp); } catch {}
    throw err;
  }
  return payload;
}

// ---------- Driver registry: Promise-cached per backend ----------

async function _drainAllDrivers() {
  const promises = [..._driverPromises.values()];
  _driverPromises.clear();
  for (const p of promises) {
    try {
      const inst = await p;
      if (inst && typeof inst.close === 'function') await inst.close();
    } catch {
      // Already-failed init promises produce no instance to close — ignore.
    }
  }
}

async function _drainDriverInBackground(backendId, oldPromise) {
  // Match reloadBackend's drain semantics: keep the old client alive for
  // OLD_BACKEND_DRAIN_MS so in-flight requests can finish, then close.
  const timer = setTimeout(async () => {
    try {
      const inst = await oldPromise;
      if (inst && typeof inst.close === 'function') await inst.close();
    } catch (err) {
      console.warn(`[storage] background drain of backend "${backendId}" failed:`, err);
    }
  }, OLD_BACKEND_DRAIN_MS);
  if (typeof timer.unref === 'function') timer.unref();
}

export async function getConfig() {
  if (_config) return _config;
  if (!_configReadPromise) {
    _configReadPromise = (async () => {
      try {
        // Run pending schema migrations before the first on-disk read.
        // The migrator uses raw fs (not getConfig), so there's no recursion.
        await ensureMigrationsApplied();
        const cfg = await _readConfigFromDisk();
        _config = cfg;
        return cfg;
      } catch (err) {
        _configReadPromise = null;
        throw err;
      }
    })();
  }
  return _configReadPromise;
}

// Internal: replace the in-memory config and write it to disk in v2 form.
// Called by addBackend / removeBackend / setDefaultBackend (post-Task 5
// callers) — at that point the on-disk format flips to v2. v1 shape is still
// produced by the legacy writeConfig() compat helper below.
async function _setConfigV2(newConfig) {
  await fs.mkdir(dirname(CONFIG_PATH), { recursive: true });
  const tmp = `${CONFIG_PATH}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(newConfig, null, 2), 'utf-8');
    await fs.rename(tmp, CONFIG_PATH);
  } catch (err) {
    try { await fs.unlink(tmp); } catch {}
    throw err;
  }
  _config = newConfig;
  _configReadPromise = Promise.resolve(newConfig);
}

// Public form retained for legacy callers — many tests use setConfig directly.
// Drains every driver before swapping (existing behavior).
export async function setConfig(newConfig) {
  await _drainAllDrivers();
  await _setConfigV2(newConfig);
}

export async function getDriverFor(backendId) {
  if (_driverPromises.has(backendId)) return _driverPromises.get(backendId);
  // Build the promise BEFORE any await so concurrent callers see the cached
  // promise on their next event-loop check. If we awaited getConfig() before
  // setting the cache, a Promise.all([getDriverFor(x), getDriverFor(x), ...])
  // would race past the empty cache and call the factory N times.
  const promise = (async () => {
    const cfg = await getConfig();
    const backend = cfg.backends.find((b) => b.id === backendId);
    if (!backend) throw new Error(`Unknown backend: ${backendId}`);
    const factory = DRIVER_FACTORIES[backend.driver];
    if (!factory) throw new Error(`Unknown driver: ${backend.driver}`);
    const inst = factory(backend.config || {});
    await inst.init();
    return inst;
  })();
  _driverPromises.set(backendId, promise);
  // Fail-soft cache eviction: a failed init must not permanently brick the
  // backend in this process. The next getDriverFor call reinstantiates.
  promise.catch(() => {
    if (_driverPromises.get(backendId) === promise) _driverPromises.delete(backendId);
  });
  return promise;
}

async function _defaultDriver() {
  const cfg = await getConfig();
  return getDriverFor(cfg.default_backend_id);
}

// ---------- Per-backend API (Plan 2 will migrate routes onto these) ----------

export async function readStoreFromBackend(backendId, relPath, fallback) {
  const driver = await getDriverFor(backendId);
  return driver.readJsonFile(relPath, fallback);
}

export async function writeStoreToBackend(backendId, relPath, data) {
  const driver = await getDriverFor(backendId);
  return driver.writeJsonFileAtomic(relPath, data);
}

export async function withStoreLockOnBackend(backendId, relPath, mutator) {
  const driver = await getDriverFor(backendId);
  return driver.withFileLock(relPath, mutator);
}

// ---------- Compat layer: route old callers to the default backend ----------

export async function readStore(relPath, fallback) {
  const driver = await _defaultDriver();
  return driver.readJsonFile(relPath, fallback);
}

export async function writeStore(relPath, data) {
  const driver = await _defaultDriver();
  return driver.writeJsonFileAtomic(relPath, data);
}

export async function withStoreLock(relPath, mutator) {
  const driver = await _defaultDriver();
  return driver.withFileLock(relPath, mutator);
}

// ---------- Backend management API (Plan 3 — usable now from tests) ----------

export async function addBackend(spec) {
  const cfg = await getConfig();
  const id = `b-${randomUUID()}`;
  const backend = {
    id,
    name: spec.name,
    driver: spec.driver,
    config: spec.config,
  };
  const next = { ...cfg, backends: [...cfg.backends, backend] };
  // No drain — adding a backend doesn't invalidate existing ones.
  await _setConfigV2(next);
  return id;
}

export async function removeBackend(backendId) {
  if (backendId === 'local') throw new Error('Cannot remove the local backend');
  const cfg = await getConfig();
  if (cfg.default_backend_id === backendId) {
    throw new Error('Cannot remove the default backend; change default first');
  }
  // Close just this driver's client — leave the others cached.
  if (_driverPromises.has(backendId)) {
    const oldPromise = _driverPromises.get(backendId);
    _driverPromises.delete(backendId);
    try {
      const inst = await oldPromise;
      if (inst && typeof inst.close === 'function') await inst.close();
    } catch {}
  }
  const next = {
    ...cfg,
    backends: cfg.backends.filter((b) => b.id !== backendId),
  };
  await _setConfigV2(next);
}

export async function setDefaultBackend(backendId) {
  const cfg = await getConfig();
  if (!cfg.backends.find((b) => b.id === backendId)) {
    throw new Error(`Unknown backend: ${backendId}`);
  }
  await _setConfigV2({ ...cfg, default_backend_id: backendId });
}

// ---------- Test utilities ----------

export async function resetForTests() {
  await _drainAllDrivers();
  _config = null;
  _configReadPromise = null;
  _reloadPromise = null;
  _resetMigrationsForTests();
  try { await fs.unlink(CONFIG_PATH); } catch {}
  try { await fs.unlink(LEGACY_MONGO_CONFIG_PATH); } catch {}
  // Restore the real factories — tests may have stubbed them.
  DRIVER_FACTORIES.file = (config) => new FileDriver(config);
  DRIVER_FACTORIES.s3 = (config) => new S3Driver(config);
  DRIVER_FACTORIES.mongo = (config) => new MongoDriver(config);
}

export function _setDriverFactoryForTests(driverName, factory) {
  DRIVER_FACTORIES[driverName] = factory;
}

// ---------- Legacy/compat exports preserved for existing callers ----------

// Canonical list of all data files the storage layer manages. The original
// storage-sync routes iterated this; those were removed in Task 9 (Plan 1).
// Kept exported for any tooling/script that wants the canonical inventory.
export const DATA_REL_PATHS = Object.freeze([
  'data/projects.json',
  'data/flows.json',
  'data/flow-groups.json',
  'data/groups.json',
  'data/notes.json',
  'data/prompts.json',
  'data/prompt-groups.json',
  'data/servers.json',
  'data/sessions.json',
  'data/compose-drafts.json',
  'data/recent-cwds.json',
  'data/intelligence-config.json',
  'data/task-boards.json',
  'data/task-board-groups.json',
]);

// Helper: which backend is the "default" right now (sync, reads cached config).
function _defaultBackendSync() {
  if (!_config) return null;
  return _config.backends.find((b) => b.id === _config.default_backend_id) || null;
}

// Sync accessor used by the storage-config GET handler. Falls back to 'file'
// when the config hasn't been read yet (the route always awaits readConfigAsync
// before calling this, so the cache is warm in practice).
export function getActiveDriver() {
  const def = _defaultBackendSync();
  return def?.driver || 'file';
}

// Returns the v1-shaped active config (or null when on the local file driver).
export function getActiveConfig() {
  const def = _defaultBackendSync();
  if (!def || def.driver === 'file') return null;
  return { ...def.config, driver: def.driver };
}

// True when any remote driver (not `file`) is the default.
export function isRemoteStorageActive() {
  return getActiveDriver() !== 'file';
}

// Back-compat for v1.5.x callers that predate multi-driver support.
export function isMongoMode() {
  return getActiveDriver() === 'mongo';
}

// Returns the v1-shaped on-disk config (or null when the default is local
// file). Used by the existing storage-config UI route — its shape is a
// contract; do not change it without updating that consumer.
export async function readConfigAsync() {
  const cfg = await getConfig();
  const def = cfg.backends.find((b) => b.id === cfg.default_backend_id);
  if (!def || def.driver === 'file') return null;
  return { ...def.config, driver: def.driver };
}

// Accepts a v1-shaped { driver, ...config } object. Internally upgrades the
// in-memory v2 representation: keeps the local backend, replaces any prior
// non-local backend with the new one, and makes it the default.
//
// The on-disk format remains v1 here so storage-config writes stay
// round-trippable with the legacy reader (Tasks 7/8 will migrate the disk
// format to v2 with proper migration locks).
export async function writeConfig(rawConfig) {
  const v1 = normalizeV1Config(rawConfig);
  if (!v1) throw new Error('invalid storage config');
  const payload = await _writeV1ToDisk(v1);
  // Refresh in-memory v2 from the new on-disk v1.
  await _drainAllDrivers();
  _config = null;
  _configReadPromise = null;
  return payload;
}

// "Deactivate" — go back to local-only.
export async function deleteConfig() {
  let existed = false;
  try {
    await fs.unlink(CONFIG_PATH);
    existed = true;
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err;
  }
  await _drainAllDrivers();
  _config = null;
  _configReadPromise = null;
  return existed;
}

// Swap the active storage backend at runtime without restarting the frontend.
// Serialized by a single-flight promise so concurrent PUT/DELETE can't leak
// resources or interleave state resets. The previous default driver is drained
// in the background for OLD_BACKEND_DRAIN_MS so in-flight requests finish.
export async function reloadBackend() {
  if (_reloadPromise) return _reloadPromise;
  _reloadPromise = (async () => {
    try {
      // Capture the current default backend's driver promise (if any) so we
      // can drain it after swapping. The driver may not be cached yet — that's
      // fine, nothing to drain.
      const oldDefaultId = _config?.default_backend_id;
      const oldPromise = oldDefaultId ? _driverPromises.get(oldDefaultId) : null;

      // Force a fresh config read.
      _config = null;
      _configReadPromise = null;
      const cfg = await getConfig();
      const newDefaultId = cfg.default_backend_id;

      // If the default backend slot has a stale promise (e.g., reused id but
      // different config), evict it so the next init builds a fresh client.
      if (_driverPromises.has(newDefaultId) && _driverPromises.get(newDefaultId) === oldPromise) {
        _driverPromises.delete(newDefaultId);
      }

      // Force init so any failure surfaces immediately to the caller.
      try {
        await getDriverFor(newDefaultId);
      } catch (err) {
        // Failed init — clear cached promise so the next attempt retries.
        if (_driverPromises.has(newDefaultId)) _driverPromises.delete(newDefaultId);
        throw err;
      }

      // Drain the old default driver in the background.
      if (oldPromise && oldPromise !== _driverPromises.get(newDefaultId)) {
        await _drainDriverInBackground(oldDefaultId, oldPromise);
      }
    } finally {
      _reloadPromise = null;
    }
  })();
  return _reloadPromise;
}

// getDriverModule(driverName) returns the legacy module facade. The previous
// storage-sync routes were the only consumers; they were removed in Task 9
// because clearStorageCollection() would wipe a shared backend prefix in v4.
// Kept here as a thin compat seam in case any out-of-tree script still uses it.
export async function getDriverModule(driverName) {
  if (driverName === 'file') return fileStoreLegacy;
  if (driverName === 's3') return s3StoreLegacy;
  if (driverName === 'mongo') return mongoStoreLegacy;
  throw new Error(`Unknown driver: ${driverName}`);
}

// Compat re-export of the file driver module. The storage-sync routes that
// used this were removed in Task 9 -- left in place as a thin compat seam.
export { fileStoreLegacy as fileStore };
