import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  S3Client,
  HeadBucketCommand,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { sdkStreamMixin } from '@smithy/util-stream';
import { Readable } from 'stream';

import { S3Driver } from '../s3Store.js';
import * as fileLock from '../migrations/locks/file-lock.js';
import * as s3Lock from '../migrations/locks/s3-lock.js';

const stringStream = (text) => sdkStreamMixin(Readable.from([Buffer.from(text)]));

describe('file-lock (no-op)', () => {
  it('always acquires', async () => {
    expect(await fileLock.acquireMigrationLock(null, 'm', 'me')).toBe(true);
  });
  it('release/heartbeat are no-ops', async () => {
    await fileLock.releaseMigrationLock(null, 'm', 'me');
    expect(await fileLock.heartbeat(null, 'm', 'me')).toBe(true);
  });
});
describe('s3-lock', () => {
  let s3Mock;
  let driver;

  beforeEach(async () => {
    s3Mock = mockClient(S3Client);
    s3Mock.on(HeadBucketCommand).resolves({});
    driver = new S3Driver({
      bucket: 'b', region: 'us-east-1',
      access_key_id: 'k', secret_access_key: 's',
      prefix: 'team-a',
    });
    await driver.init();
  });

  afterEach(() => {
    s3Mock.restore();
  });

  it('acquires when no lock exists (IfNoneMatch succeeds)', async () => {
    s3Mock.on(PutObjectCommand).resolves({ ETag: '"e1"' });
    const got = await s3Lock.acquireMigrationLock(driver, 'migrating-v4', 'owner-1');
    expect(got).toBe(true);
    const calls = s3Mock.commandCalls(PutObjectCommand);
    expect(calls[0].args[0].input.Key).toBe('team-a/.migrating-v4');
    expect(calls[0].args[0].input.IfNoneMatch).toBe('*');
  });

  it('rejects when fresh lock exists', async () => {
    // First PUT (IfNoneMatch) gets 412
    s3Mock.on(PutObjectCommand).rejectsOnce({ name: 'PreconditionFailed', $metadata: { httpStatusCode: 412 } });
    // Read shows fresh heartbeat
    s3Mock.on(GetObjectCommand).resolves({
      Body: stringStream(JSON.stringify({ owner: 'other', heartbeat_at: Date.now() })),
      ETag: '"e1"',
    });
    const got = await s3Lock.acquireMigrationLock(driver, 'migrating-v4', 'owner-1');
    expect(got).toBe(false);
  });

  it('takes over stale lock via IfMatch', async () => {
    // First PUT (IfNoneMatch) gets 412
    s3Mock.on(PutObjectCommand)
      .rejectsOnce({ name: 'PreconditionFailed', $metadata: { httpStatusCode: 412 } })
      .resolvesOnce({ ETag: '"e2"' });
    // Read shows stale heartbeat (>90s old)
    s3Mock.on(GetObjectCommand).resolves({
      Body: stringStream(JSON.stringify({ owner: 'other', heartbeat_at: Date.now() - 200000 })),
      ETag: '"e1"',
    });
    const got = await s3Lock.acquireMigrationLock(driver, 'migrating-v4', 'owner-1');
    expect(got).toBe(true);
    const calls = s3Mock.commandCalls(PutObjectCommand);
    expect(calls[1].args[0].input.IfMatch).toBe('"e1"');
  });

  it('release deletes only when owner matches', async () => {
    s3Mock.on(GetObjectCommand).resolves({
      Body: stringStream(JSON.stringify({ owner: 'someone-else', heartbeat_at: Date.now() })),
      ETag: '"e1"',
    });
    await s3Lock.releaseMigrationLock(driver, 'migrating-v4', 'owner-1');
    expect(s3Mock.commandCalls(DeleteObjectCommand)).toHaveLength(0);

    s3Mock.reset();
    s3Mock.on(HeadBucketCommand).resolves({});
    s3Mock.on(GetObjectCommand).resolves({
      Body: stringStream(JSON.stringify({ owner: 'owner-1', heartbeat_at: Date.now() })),
      ETag: '"e1"',
    });
    s3Mock.on(DeleteObjectCommand).resolves({});
    await s3Lock.releaseMigrationLock(driver, 'migrating-v4', 'owner-1');
    expect(s3Mock.commandCalls(DeleteObjectCommand)).toHaveLength(1);
  });
});
