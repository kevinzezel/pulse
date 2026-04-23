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

let _client = null;
let _config = null; // { bucket, prefix }
let _initPromise = null;

function keyFromRelPath(relPath) {
  const prefix = _config?.prefix || '';
  // Strip `data/` so it reads as `<prefix>/projects.json` etc., matching the
  // path structure someone inspecting the bucket would expect.
  const base = relPath.replace(/^data\//, '');
  return prefix ? `${prefix.replace(/\/$/, '')}/${base}` : base;
}

export async function init(config) {
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    try {
      const clientConfig = {
        region: config.region || 'us-east-1',
        credentials: {
          accessKeyId: config.access_key_id,
          secretAccessKey: config.secret_access_key,
        },
        forcePathStyle: !!config.force_path_style,
        requestHandler: { requestTimeout: CONNECT_TIMEOUT_MS, connectionTimeout: CONNECT_TIMEOUT_MS },
      };
      if (config.endpoint) clientConfig.endpoint = config.endpoint;
      _client = new S3Client(clientConfig);
      _config = { bucket: config.bucket, prefix: config.prefix || '' };
      // Validate bucket exists and credentials have access.
      await _client.send(new HeadBucketCommand({ Bucket: config.bucket }));
    } catch (err) {
      _client = null;
      _config = null;
      console.error('[s3Store] init failed:', err);
      throw new StorageUnavailableError(err);
    }
  })();
  return _initPromise;
}

export async function close() {
  const client = _client;
  _client = null;
  _config = null;
  _initPromise = null;
  if (client) {
    try { client.destroy(); } catch (err) {
      console.error('[s3Store] destroy failed:', err);
    }
  }
}

// Detach module state without destroying the client — caller will drain it.
export function beginReload() {
  const client = _client;
  _client = null;
  _config = null;
  _initPromise = null;
  // Wrap so the drainer of storage.js can call .close() uniformly across
  // Mongo (returns MongoClient with .close()) and S3 (S3Client has .destroy()).
  if (!client) return null;
  return {
    close: () => {
      try { client.destroy(); } catch {}
      return Promise.resolve();
    },
  };
}

function getClient() {
  if (!_client || !_config) throw new StorageUnavailableError('s3 not initialized');
  return _client;
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

export async function readJsonFile(relPath, fallback) {
  const key = keyFromRelPath(relPath);
  const client = getClient();
  const ctx = _versionContext.getStore();
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: _config.bucket, Key: key }));
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

export async function writeJsonFileAtomic(relPath, data) {
  const key = keyFromRelPath(relPath);
  const client = getClient();
  const ctx = _versionContext.getStore();
  const body = JSON.stringify(data);

  const insideLock = !!ctx;
  const readOccurred = insideLock && (key in ctx.etagByKey);

  const putInput = {
    Bucket: _config.bucket,
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

const _locks = new Map();

export async function withFileLock(relPath, mutator) {
  const key = keyFromRelPath(relPath);
  const previous = _locks.get(key) || Promise.resolve();
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
  _locks.set(key, run);
  try {
    return await run;
  } finally {
    if (_locks.get(key) === run) _locks.delete(key);
  }
}

// Wipe every Pulse object from the configured bucket+prefix. Only touches
// keys under our prefix — other objects in the same bucket are untouched.
export async function clearStorageCollection() {
  const client = getClient();
  const prefix = _config.prefix || '';
  try {
    let continuationToken;
    do {
      const list = await client.send(new ListObjectsV2Command({
        Bucket: _config.bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }));
      const objects = list.Contents || [];
      for (const obj of objects) {
        if (!obj.Key) continue;
        await client.send(new DeleteObjectCommand({
          Bucket: _config.bucket,
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

export async function listAllKeys() {
  const client = getClient();
  const prefix = _config.prefix || '';
  try {
    const keys = [];
    let continuationToken;
    do {
      const list = await client.send(new ListObjectsV2Command({
        Bucket: _config.bucket,
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

// Standalone helper used by the PUT /api/storage-config validation path to
// confirm a user-supplied config reaches a real bucket *before* writing it
// to disk. Returns normally on success, throws on any failure.
export async function pingS3(config) {
  const client = new S3Client({
    region: config.region || 'us-east-1',
    credentials: {
      accessKeyId: config.access_key_id,
      secretAccessKey: config.secret_access_key,
    },
    forcePathStyle: !!config.force_path_style,
    endpoint: config.endpoint || undefined,
    requestHandler: { requestTimeout: CONNECT_TIMEOUT_MS },
  });
  try {
    await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
  } finally {
    try { client.destroy(); } catch {}
  }
}
