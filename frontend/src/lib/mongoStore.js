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

export class MongoDriver {
  constructor(config) {
    this._config = {
      uri: config.uri,
      database: config.database || 'pulse',
    };
    this._client = null;
    this._db = null;
    this._locks = new Map();
  }

  async init() {
    try {
      this._client = new MongoClient(this._config.uri, {
        serverSelectionTimeoutMS: CONNECT_TIMEOUT_MS,
        connectTimeoutMS: CONNECT_TIMEOUT_MS,
      });
      await this._client.connect();
      this._db = this._client.db(this._config.database);
      await this._db.command({ ping: 1 });
    } catch (err) {
      this._client = null;
      this._db = null;
      console.error('[mongoStore] init failed:', err);
      throw new StorageUnavailableError(err);
    }
  }

  async close() {
    const client = this._client;
    this._client = null;
    this._db = null;
    if (client) {
      try { await client.close(); } catch (err) {
        console.error('[mongoStore] close failed:', err);
      }
    }
  }

  // Detach module state from the current client without closing it. Caller gets
  // a wrapper exposing .close() so storage.js can drain Mongo and S3 uniformly
  // via the same beginReload protocol.
  beginReload() {
    const client = this._client;
    this._client = null;
    this._db = null;
    if (!client) return null;
    return {
      close: async () => {
        try { await client.close(); } catch (err) {
          console.error('[mongoStore] beginReload drain close failed:', err);
        }
      },
    };
  }

  // Map a logical relative path (e.g. "data/projects/p1/flows.json") to the
  // Mongo document `_id`. Strips the leading `data/` so docs read as
  // "projects/p1/flows" — matching the S3 driver's keying. CRITICAL: this
  // preserves the full path. Pre-refactor, the implementation used only the
  // basename, which caused silent collisions between sharded files such as
  // "projects/p1/flows.json" and "projects/p2/flows.json" (both → "flows").
  _idFromRelPath(relPath) {
    const stripped = relPath.replace(/^data\//, '');
    return stripped.replace(/\.json$/, '');
  }

  _getCollection() {
    if (!this._db) throw new StorageUnavailableError('mongo not initialized');
    return this._db.collection(COLLECTION);
  }

  // Direct DB access for migration lock primitives — see migrations/locks/mongo-lock.js
  rawDb() {
    if (!this._db) throw new StorageUnavailableError('mongo not initialized');
    return this._db;
  }

  async readJsonFile(relPath, fallback) {
    const key = this._idFromRelPath(relPath);
    try {
      const doc = await this._getCollection().findOne({ _id: key });
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

  async writeJsonFileAtomic(relPath, data) {
    const key = this._idFromRelPath(relPath);
    const col = this._getCollection();
    const now = new Date().toISOString();
    const ctx = _versionContext.getStore();

    // Three write modes:
    //  1. Outside any lock (sync endpoints) -> blind upsert, caller owns concurrency.
    //  2. Inside a lock but the mutator didn't call readJsonFile first -> "blind
    //     replace" semantics (e.g., PUT /api/groups replacing the whole list).
    //     Upsert without version filter. Last-writer-wins for replace is OK.
    //  3. Inside a lock AND the mutator read first -> optimistic lock with the
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
        // Read happened and found no doc -> try insert; duplicate-key means
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

  async withFileLock(relPath, mutator) {
    const key = this._idFromRelPath(relPath);
    const previous = this._locks.get(key) || Promise.resolve();
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
    this._locks.set(key, run);
    try {
      return await run;
    } finally {
      if (this._locks.get(key) === run) this._locks.delete(key);
    }
  }

  // Wipe every Pulse document from the single storage collection. Only touches
  // the configured database's `pulse_storage` collection -- other databases and
  // other collections in the same database are untouched.
  async clearStorageCollection() {
    const col = this._getCollection();
    try {
      await col.deleteMany({});
    } catch (err) {
      console.error('[mongoStore] clearStorageCollection failed:', err);
      throw new StorageUnavailableError(err);
    }
  }

  async listAllKeys() {
    const col = this._getCollection();
    try {
      const docs = await col.find({}, { projection: { _id: 1 } }).toArray();
      return docs.map((d) => d._id);
    } catch (err) {
      console.error('[mongoStore] listAllKeys failed:', err);
      throw new StorageUnavailableError(err);
    }
  }
}

// ---------- Backwards-compatible singleton facade ----------

let _singletonInstance = null;
let _singletonInitPromise = null;

export async function init(config) {
  if (_singletonInitPromise) return _singletonInitPromise;
  _singletonInstance = new MongoDriver(config);
  _singletonInitPromise = _singletonInstance.init().catch((err) => {
    _singletonInstance = null;
    _singletonInitPromise = null;
    throw err;
  });
  return _singletonInitPromise;
}

export async function close() {
  const inst = _singletonInstance;
  _singletonInstance = null;
  _singletonInitPromise = null;
  if (inst) await inst.close();
}

export function beginReload() {
  const inst = _singletonInstance;
  _singletonInstance = null;
  _singletonInitPromise = null;
  return inst ? inst.beginReload() : null;
}

export function getDb() {
  if (!_singletonInstance) throw new StorageUnavailableError('mongo not initialized');
  return _singletonInstance.rawDb();
}

export async function readJsonFile(relPath, fallback) {
  if (!_singletonInstance) throw new StorageUnavailableError('mongo not initialized');
  return _singletonInstance.readJsonFile(relPath, fallback);
}

export async function writeJsonFileAtomic(relPath, data) {
  if (!_singletonInstance) throw new StorageUnavailableError('mongo not initialized');
  return _singletonInstance.writeJsonFileAtomic(relPath, data);
}

export async function withFileLock(relPath, mutator) {
  if (!_singletonInstance) throw new StorageUnavailableError('mongo not initialized');
  return _singletonInstance.withFileLock(relPath, mutator);
}

export async function clearStorageCollection() {
  if (!_singletonInstance) throw new StorageUnavailableError('mongo not initialized');
  return _singletonInstance.clearStorageCollection();
}

export async function listAllKeys() {
  if (!_singletonInstance) throw new StorageUnavailableError('mongo not initialized');
  return _singletonInstance.listAllKeys();
}

// Standalone helper used by the PUT /api/storage-config validation path to
// confirm a user-supplied config reaches a real database *before* writing it
// to disk. Mirrors `pingS3` in s3Store.js. Returns normally on success,
// throws on any failure. Also runs listCollections to surface auth errors
// that ping alone might not (some Atlas deployments accept ping but fail
// further calls).
export async function pingMongo(config) {
  const driver = new MongoDriver(config);
  try {
    await driver.init();
    const db = driver.rawDb();
    await db.listCollections({}, { nameOnly: true }).toArray();
  } finally {
    await driver.close();
  }
}
