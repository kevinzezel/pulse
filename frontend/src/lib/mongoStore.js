import { MongoClient } from 'mongodb';
import { _versionContext, newContext } from './storeContext.js';

const COLLECTION = 'pulse_storage';
const MAX_RETRIES = 3;
const CONNECT_TIMEOUT_MS = 3000;

export class VersionConflictError extends Error {
  constructor(relPath) {
    super(`version conflict on ${relPath}`);
    this.name = 'VersionConflictError';
  }
}

export class StorageUnavailableError extends Error {
  constructor(cause) {
    const msg = cause?.message || String(cause || 'unknown');
    super(`storage unavailable: ${msg}`);
    this.name = 'StorageUnavailableError';
    this.cause = cause;
  }
}

let _client = null;
let _db = null;
let _initPromise = null;

function keyFromRelPath(relPath) {
  const base = relPath.split('/').pop() || relPath;
  return base.replace(/\.json$/, '');
}

export async function init(config) {
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    try {
      _client = new MongoClient(config.uri, {
        serverSelectionTimeoutMS: CONNECT_TIMEOUT_MS,
        connectTimeoutMS: CONNECT_TIMEOUT_MS,
      });
      await _client.connect();
      _db = _client.db(config.database);
      await _db.command({ ping: 1 });
    } catch (err) {
      _client = null;
      _db = null;
      _initPromise = null;
      console.error('[mongoStore] init failed:', err);
      throw new StorageUnavailableError(err);
    }
  })();
  return _initPromise;
}

export async function close() {
  const client = _client;
  _client = null;
  _db = null;
  _initPromise = null;
  if (client) {
    try { await client.close(); } catch (err) {
      console.error('[mongoStore] close failed:', err);
    }
  }
}

// Detach module state from the current client without closing it. Caller gets
// the old client and is responsible for closing it after in-flight operations
// drain. A subsequent init() will build a fresh connection.
export function beginReload() {
  const client = _client;
  _client = null;
  _db = null;
  _initPromise = null;
  return client;
}

function getCollection() {
  if (!_db) throw new StorageUnavailableError('mongo not initialized');
  return _db.collection(COLLECTION);
}

export function getDb() {
  if (!_db) throw new StorageUnavailableError('mongo not initialized');
  return _db;
}

export async function readJsonFile(relPath, fallback) {
  const key = keyFromRelPath(relPath);
  try {
    const doc = await getCollection().findOne({ _id: key });
    const ctx = _versionContext.getStore();
    if (!doc) {
      // doc doesn't exist yet — capture null so the first write goes via insert
      if (ctx) ctx.versionByKey[key] = null;
      return fallback;
    }
    if (ctx) ctx.versionByKey[key] = doc._version ?? null;
    return doc.data;
  } catch (err) {
    if (err instanceof StorageUnavailableError) throw err;
    console.error('[mongoStore] readJsonFile failed:', err);
    throw new StorageUnavailableError(err);
  }
}

export async function writeJsonFileAtomic(relPath, data) {
  const key = keyFromRelPath(relPath);
  const col = getCollection();
  const now = new Date().toISOString();
  const ctx = _versionContext.getStore();

  // Three write modes:
  //  1. Outside any lock (sync endpoints) → blind upsert, caller owns concurrency.
  //  2. Inside a lock but the mutator didn't call readJsonFile first → "blind
  //     replace" semantics (e.g., PUT /api/groups replacing the whole list).
  //     Upsert without version filter. Last-writer-wins for replace is OK.
  //  3. Inside a lock AND the mutator read first → optimistic lock with the
  //     version captured at read time. This is the case that protects
  //     read-modify-write from cross-process write loss.
  const insideLock = !!ctx;
  const readOccurred = insideLock && (key in ctx.versionByKey);

  try {
    if (!insideLock || !readOccurred) {
      await col.updateOne(
        { _id: key },
        { $set: { data, updated_at: now }, $inc: { _version: 1 } },
        { upsert: true },
      );
      if (insideLock) ctx.versionByKey[key] = null; // subsequent ops in this lock shouldn't assume a version
      return;
    }

    const expected = ctx.versionByKey[key];
    if (expected === null || expected === undefined) {
      // Read happened and found no doc — try insert; duplicate-key means
      // another process created it between our read and our write.
      try {
        await col.insertOne({ _id: key, data, _version: 1, updated_at: now });
        ctx.versionByKey[key] = 1;
        return;
      } catch (err) {
        if (err?.code === 11000) throw new VersionConflictError(relPath);
        throw err;
      }
    }

    const res = await col.updateOne(
      { _id: key, _version: expected },
      { $set: { data, updated_at: now }, $inc: { _version: 1 } },
    );
    if (res.matchedCount === 0) {
      throw new VersionConflictError(relPath);
    }
    ctx.versionByKey[key] = expected + 1;
  } catch (err) {
    if (err instanceof VersionConflictError) throw err;
    if (err instanceof StorageUnavailableError) throw err;
    console.error('[mongoStore] writeJsonFileAtomic failed:', err);
    throw new StorageUnavailableError(err);
  }
}

const _locks = new Map();

export async function withFileLock(relPath, mutator) {
  const key = keyFromRelPath(relPath);
  const previous = _locks.get(key) || Promise.resolve();
  const run = (async () => {
    try { await previous; } catch {}
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      // Fresh context per attempt so a retry re-captures the current version.
      const ctx = newContext();
      try {
        return await _versionContext.run(ctx, mutator);
      } catch (err) {
        if (err instanceof VersionConflictError && attempt < MAX_RETRIES - 1) continue;
        throw err;
      }
    }
  })();
  _locks.set(key, run);
  try {
    return await run;
  } finally {
    if (_locks.get(key) === run) _locks.delete(key);
  }
}

// Wipe every Pulse document from the single storage collection. Only touches
// the configured database's `pulse_storage` collection — other databases and
// other collections in the same database are untouched.
export async function clearStorageCollection() {
  const col = getCollection();
  try {
    await col.deleteMany({});
  } catch (err) {
    console.error('[mongoStore] clearStorageCollection failed:', err);
    throw new StorageUnavailableError(err);
  }
}

export async function listAllKeys() {
  const col = getCollection();
  try {
    const docs = await col.find({}, { projection: { _id: 1 } }).toArray();
    return docs.map((d) => d._id);
  } catch (err) {
    console.error('[mongoStore] listAllKeys failed:', err);
    throw new StorageUnavailableError(err);
  }
}
