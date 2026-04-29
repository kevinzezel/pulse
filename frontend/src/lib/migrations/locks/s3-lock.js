import { GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

const HEARTBEAT_TIMEOUT_MS = 90 * 1000;

function lockKey(prefix, name) {
  const base = `.${name}`;
  return prefix ? `${prefix.replace(/\/$/, '')}/${base}` : base;
}

async function readLock(driver, name) {
  const client = driver.rawClient();
  const key = lockKey(driver.prefix(), name);
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: driver.bucket(), Key: key }));
    const text = await res.Body.transformToString('utf-8');
    return { etag: res.ETag, body: JSON.parse(text) };
  } catch (err) {
    if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NoSuchKey') return null;
    throw err;
  }
}

async function writeLock(driver, name, body, options = {}) {
  const client = driver.rawClient();
  const key = lockKey(driver.prefix(), name);
  const input = {
    Bucket: driver.bucket(),
    Key: key,
    Body: JSON.stringify(body),
    ContentType: 'application/json',
  };
  if (options.ifNoneMatch) input.IfNoneMatch = options.ifNoneMatch;
  if (options.ifMatch) input.IfMatch = options.ifMatch;
  try {
    await client.send(new PutObjectCommand(input));
    return true;
  } catch (err) {
    if (err?.$metadata?.httpStatusCode === 412 || err?.name === 'PreconditionFailed') {
      return false;
    }
    throw err;
  }
}

export async function acquireMigrationLock(driver, name, ownerId) {
  const now = Date.now();
  const body = { owner: ownerId, started_at: now, heartbeat_at: now };

  if (await writeLock(driver, name, body, { ifNoneMatch: '*' })) return true;

  const existing = await readLock(driver, name);
  if (!existing) {
    return writeLock(driver, name, body, { ifNoneMatch: '*' });
  }
  const age = now - (existing.body.heartbeat_at || 0);
  if (age < HEARTBEAT_TIMEOUT_MS) {
    return false;
  }
  return writeLock(driver, name, body, { ifMatch: existing.etag });
}

export async function releaseMigrationLock(driver, name, ownerId) {
  const existing = await readLock(driver, name);
  if (!existing || existing.body.owner !== ownerId) return;
  const client = driver.rawClient();
  const key = lockKey(driver.prefix(), name);
  await client.send(new DeleteObjectCommand({ Bucket: driver.bucket(), Key: key }));
}

export async function heartbeat(driver, name, ownerId) {
  const existing = await readLock(driver, name);
  if (!existing || existing.body.owner !== ownerId) return false;
  const next = { ...existing.body, heartbeat_at: Date.now() };
  return writeLock(driver, name, next, { ifMatch: existing.etag });
}
