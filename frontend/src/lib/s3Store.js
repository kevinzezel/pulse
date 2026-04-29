import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  HeadBucketCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { _versionContext, newContext } from './storeContext.js';

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

function isPreconditionFailed(err) {
  if (!err) return false;
  if (err.name === 'PreconditionFailed') return true;
  if (err.name === 'ConditionalRequestConflict') return true; // R2 in some cases
  if (err.$metadata?.httpStatusCode === 412) return true;
  // Some S3-compatible endpoints return 409 for IfNoneMatch conflicts — but
  // 409 is also used for bucket-state errors (OperationAborted, etc.), so
  // narrow it to errors whose code/name/message implies a precondition.
  if (err.$metadata?.httpStatusCode === 409) {
    const tag = `${err.Code || ''} ${err.name || ''} ${err.message || ''}`.toLowerCase();
    if (/precondition|if-?none-?match|if-?match|conditional/.test(tag)) return true;
  }
  return false;
}

async function streamToString(stream) {
  if (!stream) return '';
  // Node.js Readable — aggregate chunks.
  if (typeof stream.transformToString === 'function') {
    return await stream.transformToString('utf-8');
  }
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf-8');
}

export class S3Driver {
  constructor(config) {
    this._config = {
      bucket: config.bucket,
      region: config.region || 'us-east-1',
      access_key_id: config.access_key_id,
      secret_access_key: config.secret_access_key,
      endpoint: config.endpoint,
      prefix: config.prefix || '',
      force_path_style: !!config.force_path_style,
    };
    this._client = null;
    this._locks = new Map();
  }

  async init() {
    try {
      const clientConfig = {
        region: this._config.region,
        credentials: {
          accessKeyId: this._config.access_key_id,
          secretAccessKey: this._config.secret_access_key,
        },
        forcePathStyle: this._config.force_path_style,
        requestHandler: { requestTimeout: CONNECT_TIMEOUT_MS, connectionTimeout: CONNECT_TIMEOUT_MS },
      };
      if (this._config.endpoint) clientConfig.endpoint = this._config.endpoint;
      this._client = new S3Client(clientConfig);
      // Validate bucket exists and credentials have access.
      await this._client.send(new HeadBucketCommand({ Bucket: this._config.bucket }));
    } catch (err) {
      this._client = null;
      console.error('[s3Store] init failed:', err);
      throw new StorageUnavailableError(err);
    }
  }

  async close() {
    if (this._client) {
      try { this._client.destroy(); } catch (err) {
        console.error('[s3Store] destroy failed:', err);
      }
      this._client = null;
    }
  }

  // Detach module state without destroying the client — caller will drain it.
  beginReload() {
    const client = this._client;
    this._client = null;
    if (!client) return null;
    // Wrap so the drainer of storage.js can call .close() uniformly across
    // Mongo (returns MongoClient with .close()) and S3 (S3Client has .destroy()).
    return {
      close: () => {
        try { client.destroy(); } catch (err) {
          console.error('[s3Store] beginReload drain destroy failed:', err);
        }
        return Promise.resolve();
      },
    };
  }

  _keyFromRelPath(relPath) {
    const prefix = this._config.prefix;
    // Strip `data/` so it reads as `<prefix>/projects.json` etc., matching the
    // path structure someone inspecting the bucket would expect.
    const base = relPath.replace(/^data\//, '');
    return prefix ? `${prefix.replace(/\/$/, '')}/${base}` : base;
  }

  _ensureClient() {
    if (!this._client) throw new StorageUnavailableError('s3 not initialized');
    return this._client;
  }

  async readJsonFile(relPath, fallback) {
    const key = this._keyFromRelPath(relPath);
    const client = this._ensureClient();
    const ctx = _versionContext.getStore();
    try {
      const res = await client.send(new GetObjectCommand({ Bucket: this._config.bucket, Key: key }));
      const body = await streamToString(res.Body);
      if (ctx) ctx.etagByKey[key] = res.ETag || null;
      if (!body) return fallback;
      return JSON.parse(body);
    } catch (err) {
      if (err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404) {
        // Object doesn't exist — null etag so writer uses IfNoneMatch.
        if (ctx) ctx.etagByKey[key] = null;
        return fallback;
      }
      if (err instanceof StorageUnavailableError) throw err;
      console.error('[s3Store] readJsonFile failed:', err);
      throw new StorageUnavailableError(err);
    }
  }

  async writeJsonFileAtomic(relPath, data) {
    const key = this._keyFromRelPath(relPath);
    const client = this._ensureClient();
    const ctx = _versionContext.getStore();
    const body = JSON.stringify(data);

    const insideLock = !!ctx;
    const readOccurred = insideLock && (key in ctx.etagByKey);

    const putInput = {
      Bucket: this._config.bucket,
      Key: key,
      Body: body,
      ContentType: 'application/json',
    };

    try {
      if (!insideLock || !readOccurred) {
        // Blind put — sync endpoints or PUT-replace routes. Last-writer-wins semantic.
        await client.send(new PutObjectCommand(putInput));
        if (insideLock) ctx.etagByKey[key] = null;
        return;
      }

      const expectedEtag = ctx.etagByKey[key];
      if (expectedEtag === null || expectedEtag === undefined) {
        // Read found no object — ensure another process didn't create it between
        // our read and write.
        putInput.IfNoneMatch = '*';
        try {
          const res = await client.send(new PutObjectCommand(putInput));
          ctx.etagByKey[key] = res.ETag || null;
          return;
        } catch (err) {
          if (isPreconditionFailed(err)) throw new VersionConflictError(relPath);
          throw err;
        }
      }

      putInput.IfMatch = expectedEtag;
      try {
        const res = await client.send(new PutObjectCommand(putInput));
        ctx.etagByKey[key] = res.ETag || null;
      } catch (err) {
        if (isPreconditionFailed(err)) throw new VersionConflictError(relPath);
        throw err;
      }
    } catch (err) {
      if (err instanceof VersionConflictError) throw err;
      if (err instanceof StorageUnavailableError) throw err;
      console.error('[s3Store] writeJsonFileAtomic failed:', err);
      throw new StorageUnavailableError(err);
    }
  }

  async withFileLock(relPath, mutator) {
    const key = this._keyFromRelPath(relPath);
    const previous = this._locks.get(key) || Promise.resolve();
    const run = (async () => {
      try { await previous; } catch {}
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
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

  // Wipe every Pulse object from the configured bucket+prefix. Only touches
  // keys under our prefix — other objects in the same bucket are untouched.
  async clearStorageCollection() {
    const client = this._ensureClient();
    const prefix = this._config.prefix;
    try {
      let continuationToken;
      do {
        const list = await client.send(new ListObjectsV2Command({
          Bucket: this._config.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }));
        const objects = list.Contents || [];
        for (const obj of objects) {
          if (!obj.Key) continue;
          await client.send(new DeleteObjectCommand({
            Bucket: this._config.bucket,
            Key: obj.Key,
          }));
        }
        continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
      } while (continuationToken);
    } catch (err) {
      console.error('[s3Store] clearStorageCollection failed:', err);
      throw new StorageUnavailableError(err);
    }
  }

  async listAllKeys() {
    const client = this._ensureClient();
    const prefix = this._config.prefix;
    try {
      const keys = [];
      let continuationToken;
      do {
        const list = await client.send(new ListObjectsV2Command({
          Bucket: this._config.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }));
        for (const obj of list.Contents || []) {
          if (obj.Key) keys.push(obj.Key);
        }
        continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
      } while (continuationToken);
      return keys;
    } catch (err) {
      console.error('[s3Store] listAllKeys failed:', err);
      throw new StorageUnavailableError(err);
    }
  }

  // Direct S3 access for migration lock primitives — see migrations/locks/s3-lock.js
  rawClient() {
    return this._ensureClient();
  }

  bucket() {
    return this._config.bucket;
  }

  prefix() {
    return this._config.prefix;
  }
}

// ---------- Backwards-compatible singleton facade ----------

let _singletonInstance = null;
let _singletonInitPromise = null;

export async function init(config) {
  if (_singletonInitPromise) return _singletonInitPromise;
  _singletonInstance = new S3Driver(config);
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

export async function readJsonFile(relPath, fallback) {
  if (!_singletonInstance) throw new StorageUnavailableError('s3 not initialized');
  return _singletonInstance.readJsonFile(relPath, fallback);
}

export async function writeJsonFileAtomic(relPath, data) {
  if (!_singletonInstance) throw new StorageUnavailableError('s3 not initialized');
  return _singletonInstance.writeJsonFileAtomic(relPath, data);
}

export async function withFileLock(relPath, mutator) {
  if (!_singletonInstance) throw new StorageUnavailableError('s3 not initialized');
  return _singletonInstance.withFileLock(relPath, mutator);
}

export async function clearStorageCollection() {
  if (!_singletonInstance) throw new StorageUnavailableError('s3 not initialized');
  return _singletonInstance.clearStorageCollection();
}

export async function listAllKeys() {
  if (!_singletonInstance) throw new StorageUnavailableError('s3 not initialized');
  return _singletonInstance.listAllKeys();
}

// Standalone helper used by the PUT /api/storage-config validation path to
// confirm a user-supplied config reaches a real bucket *before* writing it
// to disk. Returns normally on success, throws on any failure.
export async function pingS3(config) {
  const driver = new S3Driver(config);
  try {
    await driver.init();
  } finally {
    await driver.close();
  }
}
