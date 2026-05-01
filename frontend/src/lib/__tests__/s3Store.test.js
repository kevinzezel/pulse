import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  S3Client,
  HeadBucketCommand,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { sdkStreamMixin } from '@smithy/util-stream';
import { Readable } from 'stream';
import { S3Driver, VersionConflictError, StorageUnavailableError } from '../s3Store.js';

const stringStream = (text) => sdkStreamMixin(Readable.from([Buffer.from(text)]));

describe('S3Driver', () => {
  let s3Mock;

  beforeEach(() => {
    s3Mock = mockClient(S3Client);
  });

  afterEach(() => {
    s3Mock.restore();
  });

  it('init validates bucket via HeadBucket', async () => {
    s3Mock.on(HeadBucketCommand).resolves({});
    const driver = new S3Driver({
      bucket: 'b', region: 'us-east-1',
      access_key_id: 'k', secret_access_key: 's',
    });
    await driver.init();
    expect(s3Mock.commandCalls(HeadBucketCommand)).toHaveLength(1);
  });

  it('init throws StorageUnavailableError on HeadBucket failure', async () => {
    s3Mock.on(HeadBucketCommand).rejects(new Error('forbidden'));
    const driver = new S3Driver({
      bucket: 'b', region: 'us-east-1',
      access_key_id: 'k', secret_access_key: 's',
    });
    await expect(driver.init()).rejects.toThrow(StorageUnavailableError);
  });

  it('readJsonFile returns fallback on NoSuchKey', async () => {
    s3Mock.on(HeadBucketCommand).resolves({});
    s3Mock.on(GetObjectCommand).rejects({ name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
    const driver = new S3Driver({ bucket: 'b', region: 'us-east-1', access_key_id: 'k', secret_access_key: 's' });
    await driver.init();
    const data = await driver.readJsonFile('missing.json', { fallback: true });
    expect(data).toEqual({ fallback: true });
  });

  it('readJsonFile parses returned body', async () => {
    s3Mock.on(HeadBucketCommand).resolves({});
    s3Mock.on(GetObjectCommand).resolves({
      Body: stringStream('{"hello":"world"}'),
      ETag: '"abc123"',
    });
    const driver = new S3Driver({ bucket: 'b', region: 'us-east-1', access_key_id: 'k', secret_access_key: 's' });
    await driver.init();
    const data = await driver.readJsonFile('foo.json', null);
    expect(data).toEqual({ hello: 'world' });
  });

  it('writeJsonFileAtomic does blind put outside lock context', async () => {
    s3Mock.on(HeadBucketCommand).resolves({});
    s3Mock.on(PutObjectCommand).resolves({ ETag: '"new-etag"' });
    const driver = new S3Driver({ bucket: 'b', region: 'us-east-1', access_key_id: 'k', secret_access_key: 's' });
    await driver.init();
    await driver.writeJsonFileAtomic('foo.json', { x: 1 });
    const calls = s3Mock.commandCalls(PutObjectCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input.IfMatch).toBeUndefined();
    expect(calls[0].args[0].input.IfNoneMatch).toBeUndefined();
  });

  it('withFileLock retries on VersionConflictError', async () => {
    s3Mock.on(HeadBucketCommand).resolves({});
    s3Mock.on(GetObjectCommand)
      .resolvesOnce({ Body: stringStream('{"n":1}'), ETag: '"e1"' })
      .resolvesOnce({ Body: stringStream('{"n":2}'), ETag: '"e2"' });
    s3Mock.on(PutObjectCommand)
      .rejectsOnce({ name: 'PreconditionFailed', $metadata: { httpStatusCode: 412 } })
      .resolvesOnce({ ETag: '"e3"' });

    const driver = new S3Driver({ bucket: 'b', region: 'us-east-1', access_key_id: 'k', secret_access_key: 's' });
    await driver.init();

    const result = await driver.withFileLock('counter.json', async () => {
      const data = await driver.readJsonFile('counter.json', { n: 0 });
      await driver.writeJsonFileAtomic('counter.json', { n: data.n + 1 });
      return data.n + 1;
    });

    expect(result).toBe(3);
    expect(s3Mock.commandCalls(GetObjectCommand)).toHaveLength(2);
  });

  it('two S3Driver instances with different prefixes are independent', async () => {
    s3Mock.on(HeadBucketCommand).resolves({});
    const dA = new S3Driver({ bucket: 'b', region: 'us-east-1', access_key_id: 'k', secret_access_key: 's', prefix: 'team-a' });
    const dB = new S3Driver({ bucket: 'b', region: 'us-east-1', access_key_id: 'k', secret_access_key: 's', prefix: 'team-b' });
    await dA.init();
    await dB.init();
    s3Mock.on(PutObjectCommand).resolves({ ETag: '"e"' });
    await dA.writeJsonFileAtomic('foo.json', { x: 1 });
    await dB.writeJsonFileAtomic('foo.json', { y: 2 });
    const calls = s3Mock.commandCalls(PutObjectCommand);
    expect(calls.find(c => c.args[0].input.Key === 'team-a/foo.json')).toBeDefined();
    expect(calls.find(c => c.args[0].input.Key === 'team-b/foo.json')).toBeDefined();
  });

  it('deleteFile sends DeleteObjectCommand and returns true', async () => {
    s3Mock.on(HeadBucketCommand).resolves({});
    s3Mock.on(DeleteObjectCommand).resolves({});
    const driver = new S3Driver({ bucket: 'b', region: 'us-east-1', access_key_id: 'k', secret_access_key: 's' });
    await driver.init();
    expect(await driver.deleteFile('foo.json')).toBe(true);
    const calls = s3Mock.commandCalls(DeleteObjectCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input.Key).toBe('foo.json');
  });

  it('deleteFile returns false on 404', async () => {
    s3Mock.on(HeadBucketCommand).resolves({});
    s3Mock.on(DeleteObjectCommand).rejects({ name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
    const driver = new S3Driver({ bucket: 'b', region: 'us-east-1', access_key_id: 'k', secret_access_key: 's' });
    await driver.init();
    expect(await driver.deleteFile('nonexistent.json')).toBe(false);
  });

  it('writeBinaryFileAtomic sends PutObject with body and ContentType', async () => {
    s3Mock.on(HeadBucketCommand).resolves({});
    s3Mock.on(PutObjectCommand).resolves({});
    const driver = new S3Driver({ bucket: 'b', region: 'us-east-1', access_key_id: 'k', secret_access_key: 's', prefix: 'tenant' });
    await driver.init();
    const buf = Buffer.from([0xff, 0x00, 0x10, 0x42]);
    await driver.writeBinaryFileAtomic('data/projects/p1/attachments/a1/img.png', buf, { contentType: 'image/png' });
    const calls = s3Mock.commandCalls(PutObjectCommand);
    expect(calls).toHaveLength(1);
    const input = calls[0].args[0].input;
    // `data/` is stripped, bucket prefix is prepended.
    expect(input.Key).toBe('tenant/projects/p1/attachments/a1/img.png');
    expect(input.ContentType).toBe('image/png');
    // Body is the same bytes.
    expect(Buffer.from(input.Body).equals(buf)).toBe(true);
    // No If-Match / If-None-Match: write-once semantics for attachments.
    expect(input.IfMatch).toBeUndefined();
    expect(input.IfNoneMatch).toBeUndefined();
  });

  it('readBinaryFile parses GetObject body into a buffer with contentType', async () => {
    s3Mock.on(HeadBucketCommand).resolves({});
    const buf = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
    s3Mock.on(GetObjectCommand).resolves({
      Body: sdkStreamMixin(Readable.from([buf])),
      ContentType: 'application/pdf',
    });
    const driver = new S3Driver({ bucket: 'b', region: 'us-east-1', access_key_id: 'k', secret_access_key: 's' });
    await driver.init();
    const out = await driver.readBinaryFile('data/projects/p1/attachments/a1/doc.pdf');
    expect(out).not.toBeNull();
    expect(out.contentType).toBe('application/pdf');
    expect(Buffer.compare(out.buffer, buf)).toBe(0);
  });

  it('readBinaryFile returns null on NoSuchKey', async () => {
    s3Mock.on(HeadBucketCommand).resolves({});
    s3Mock.on(GetObjectCommand).rejects({ name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
    const driver = new S3Driver({ bucket: 'b', region: 'us-east-1', access_key_id: 'k', secret_access_key: 's' });
    await driver.init();
    const out = await driver.readBinaryFile('data/projects/p1/attachments/missing/blob.bin');
    expect(out).toBeNull();
  });

  it('deletePrefix lists and deletes every key under the prefix', async () => {
    s3Mock.on(HeadBucketCommand).resolves({});
    s3Mock.on(ListObjectsV2Command)
      .resolvesOnce({
        Contents: [
          { Key: 'tenant/projects/p1/attachments/a1/img.png' },
          { Key: 'tenant/projects/p1/attachments/a2/doc.pdf' },
        ],
        IsTruncated: true,
        NextContinuationToken: 'tok',
      })
      .resolvesOnce({
        Contents: [{ Key: 'tenant/projects/p1/attachments/a3/big.bin' }],
        IsTruncated: false,
      });
    s3Mock.on(DeleteObjectCommand).resolves({});
    const driver = new S3Driver({ bucket: 'b', region: 'us-east-1', access_key_id: 'k', secret_access_key: 's', prefix: 'tenant' });
    await driver.init();
    const ok = await driver.deletePrefix('data/projects/p1/attachments');
    expect(ok).toBe(true);

    // ListObjectsV2 was called with the bucket-prefixed key prefix.
    const lists = s3Mock.commandCalls(ListObjectsV2Command);
    expect(lists).toHaveLength(2);
    expect(lists[0].args[0].input.Prefix).toBe('tenant/projects/p1/attachments');

    const deletes = s3Mock.commandCalls(DeleteObjectCommand);
    expect(deletes).toHaveLength(3);
    const deletedKeys = deletes.map((c) => c.args[0].input.Key).sort();
    expect(deletedKeys).toEqual([
      'tenant/projects/p1/attachments/a1/img.png',
      'tenant/projects/p1/attachments/a2/doc.pdf',
      'tenant/projects/p1/attachments/a3/big.bin',
    ]);
  });

  it('deletePrefix returns true even when nothing matched (idempotent cleanup)', async () => {
    s3Mock.on(HeadBucketCommand).resolves({});
    s3Mock.on(ListObjectsV2Command).resolves({ Contents: [], IsTruncated: false });
    const driver = new S3Driver({ bucket: 'b', region: 'us-east-1', access_key_id: 'k', secret_access_key: 's' });
    await driver.init();
    const ok = await driver.deletePrefix('data/projects/p-missing/attachments');
    expect(ok).toBe(true);
    expect(s3Mock.commandCalls(DeleteObjectCommand)).toHaveLength(0);
  });

  it('listAllKeys returns keys under the prefix across pagination', async () => {
    s3Mock.on(HeadBucketCommand).resolves({});
    s3Mock.on(ListObjectsV2Command)
      .resolvesOnce({
        Contents: [{ Key: 'team-a/projects/p1/flows.json' }, { Key: 'team-a/projects/p1/notes.json' }],
        IsTruncated: true,
        NextContinuationToken: 'tok',
      })
      .resolvesOnce({
        Contents: [{ Key: 'team-a/projects/p2/flows.json' }],
        IsTruncated: false,
      });
    const driver = new S3Driver({ bucket: 'b', region: 'us-east-1', access_key_id: 'k', secret_access_key: 's', prefix: 'team-a' });
    await driver.init();
    const keys = await driver.listAllKeys();
    expect(keys).toEqual([
      'team-a/projects/p1/flows.json',
      'team-a/projects/p1/notes.json',
      'team-a/projects/p2/flows.json',
    ]);
  });
});
