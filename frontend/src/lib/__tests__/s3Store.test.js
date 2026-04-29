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
