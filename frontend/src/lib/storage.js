import { promises as fs } from 'fs';
import fsSync from 'fs';
import path from 'path';
import * as fileStore from './jsonStore.js';

const FRONTEND_ROOT = process.env.PULSE_FRONTEND_ROOT || process.cwd();
const CONFIG_REL = 'data/storage-config.json';
const LEGACY_MONGO_CONFIG_REL = 'data/mongo-config.json';
const CONFIG_PATH = path.join(FRONTEND_ROOT, CONFIG_REL);
const LEGACY_MONGO_CONFIG_PATH = path.join(FRONTEND_ROOT, LEGACY_MONGO_CONFIG_REL);
const DEFAULT_MONGO_DATABASE = 'pulse';

// 10s grace period for in-flight requests using the old client to complete
// before the connection is closed during a hot-reload. Picked as a ceiling
// well above any normal op latency but low enough to release native
// resources promptly. Bump if you see abrupt-close errors in logs.
const OLD_BACKEND_DRAIN_MS = 10000;

// Supported driver identifiers. Kept in one place so UI / validation /
// persistence stay in sync.
export const DRIVERS = Object.freeze(['file', 'mongo', 's3']);

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

// Turn a raw object into a valid storage config, or null if invalid.
// File driver has no params; returning null signals "no remote config".
function normalizeConfig(raw) {
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

function readConfigSyncRaw(filePath) {
  try {
    const raw = fsSync.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeConfigFileAtomic(filePath, payload) {
  const dir = path.dirname(filePath);
  if (!fsSync.existsSync(dir)) fsSync.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.${Date.now()}.tmp`;
  try {
    fsSync.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf-8');
    fsSync.renameSync(tmp, filePath);
  } catch (err) {
    try { fsSync.unlinkSync(tmp); } catch {}
    throw err;
  }
}

// Read config from disk async (used by API routes).
export async function readConfigAsync() {
  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf-8');
    return normalizeConfig(JSON.parse(raw));
  } catch (err) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
}

export async function writeConfig(config) {
  const normalized = normalizeConfig(config);
  if (!normalized) {
    throw new Error('invalid storage config');
  }
  await fs.mkdir(path.dirname(CONFIG_PATH), { recursive: true });
  const payload = { ...normalized, updated_at: new Date().toISOString() };
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

export async function deleteConfig() {
  try {
    await fs.unlink(CONFIG_PATH);
    return true;
  } catch (err) {
    if (err?.code === 'ENOENT') return false;
    throw err;
  }
}

let _active_config = null;
let _active_driver = 'file';
let _config_loaded = false;
let _backend_promise = null;
let _reload_promise = null;

// Lazily populate _active_config on first access. Sync I/O here keeps
// isMongoMode() / getActiveConfig() / getActiveDriver() synchronous for
// callers like the GET /api/storage-config route.
function loadConfigIfNeeded() {
  if (_config_loaded) return;

  // Try new unified config first.
  let parsed = readConfigSyncRaw(CONFIG_PATH);
  if (!parsed) {
    // Try legacy mongo-config.json and migrate if present.
    const legacy = readConfigSyncRaw(LEGACY_MONGO_CONFIG_PATH);
    if (legacy) {
      const normalized = normalizeMongoParams(legacy);
      if (normalized) {
        const migrated = { driver: 'mongo', ...normalized, updated_at: new Date().toISOString() };
        try {
          writeConfigFileAtomic(CONFIG_PATH, migrated);
          try { fsSync.unlinkSync(LEGACY_MONGO_CONFIG_PATH); } catch {}
          parsed = migrated;
        } catch (err) {
          console.error('[storage] legacy mongo-config.json migration failed:', err);
        }
      }
    }
  }

  _active_config = normalizeConfig(parsed);
  _active_driver = _active_config?.driver || 'file';
  _config_loaded = true;
}

async function loadDriverModule(driver) {
  if (driver === 'mongo') return await import('./mongoStore.js');
  if (driver === 's3') return await import('./s3Store.js');
  // 'file' is bundled directly — no dynamic import needed.
  return fileStore;
}

async function getBackend() {
  loadConfigIfNeeded();
  if (_backend_promise) return _backend_promise;
  const configAtBoot = _active_config;
  const driverAtBoot = _active_driver;
  _backend_promise = (async () => {
    if (!configAtBoot || driverAtBoot === 'file') return fileStore;
    const mod = await loadDriverModule(driverAtBoot);
    await mod.init(configAtBoot);
    return mod;
  })();
  return _backend_promise;
}

// Swap the active storage backend at runtime without restarting the frontend.
// Serialized by a single-flight promise so concurrent PUT/DELETE can't leak
// resources or interleave state resets. In-flight requests continue on the
// old backend; the old client is drained for OLD_BACKEND_DRAIN_MS in the
// background before being closed.
export async function reloadBackend() {
  if (_reload_promise) return _reload_promise;
  _reload_promise = (async () => {
    try {
      const newConfig = await readConfigAsync();
      const oldDriver = _active_driver;

      // Detach the old driver's client (if any) before resetting state so
      // a new init() builds a fresh connection.
      let oldHandle = null;
      if (oldDriver && oldDriver !== 'file') {
        try {
          const mod = await loadDriverModule(oldDriver);
          if (typeof mod.beginReload === 'function') {
            oldHandle = mod.beginReload();
          }
        } catch {}
      }

      _active_config = newConfig;
      _active_driver = newConfig?.driver || 'file';
      _config_loaded = true;
      _backend_promise = null;

      // Force init so any failure surfaces immediately to the caller.
      // On failure, clear _backend_promise so the caller (or a subsequent
      // reloadBackend after rollback) re-initializes from scratch rather
      // than awaiting a rejected promise forever.
      try {
        await getBackend();
      } catch (err) {
        _backend_promise = null;
        throw err;
      }

      // Drain the old client in the background.
      if (oldHandle && typeof oldHandle.close === 'function') {
        const timer = setTimeout(() => {
          Promise.resolve(oldHandle.close()).catch((err) => {
            console.warn('[storage] old client close failed:', err);
          });
        }, OLD_BACKEND_DRAIN_MS);
        if (typeof timer.unref === 'function') timer.unref();
      }
    } finally {
      _reload_promise = null;
    }
  })();
  return _reload_promise;
}

export async function readStore(relPath, fallback) {
  const backend = await getBackend();
  return backend.readJsonFile(relPath, fallback);
}

export async function writeStore(relPath, data) {
  const backend = await getBackend();
  return backend.writeJsonFileAtomic(relPath, data);
}

export async function withStoreLock(relPath, mutator) {
  const backend = await getBackend();
  return backend.withFileLock(relPath, mutator);
}

export function getActiveDriver() {
  loadConfigIfNeeded();
  return _active_driver;
}

// True when any remote driver (not `file`) is active.
export function isRemoteStorageActive() {
  loadConfigIfNeeded();
  return _active_driver !== 'file';
}

// Back-compat for v1.5.x callers that predate multi-driver support.
export function isMongoMode() {
  return getActiveDriver() === 'mongo';
}

export function getActiveConfig() {
  loadConfigIfNeeded();
  return _active_config ? { ..._active_config } : null;
}

// Canonical list of all data files the storage layer manages. Both sync
// endpoints iterate this. Keep in sync with every API route that goes
// through storage.js — adding a new data file without adding it here means
// the sync buttons silently skip it.
export const DATA_REL_PATHS = Object.freeze([
  'data/projects.json',
  'data/flows.json',
  'data/groups.json',
  'data/notes.json',
  'data/prompts.json',
  'data/servers.json',
  'data/sessions.json',
  'data/compose-drafts.json',
]);

// Load the module for a specific driver (file/mongo/s3). Used by sync
// endpoints that need to talk to both the local file store and the active
// remote driver in the same request.
export async function getDriverModule(driver) {
  return await loadDriverModule(driver);
}

export { fileStore };
