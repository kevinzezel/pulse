import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { MongoDriver } from '../mongoStore.js';

describe('MongoDriver', () => {
  let mongo;
  let uri;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    uri = mongo.getUri();
  }, 60000);

  afterAll(async () => {
    if (mongo) await mongo.stop();
  });

  beforeEach(async () => {
    const client = new MongoClient(uri);
    await client.connect();
    await client.db('pulse_test').dropDatabase();
    await client.close();
  });

  it('init connects and pings', async () => {
    const driver = new MongoDriver({ uri, database: 'pulse_test' });
    await driver.init();
    await driver.close();
  });

  it('readJsonFile returns fallback when document missing', async () => {
    const driver = new MongoDriver({ uri, database: 'pulse_test' });
    await driver.init();
    const data = await driver.readJsonFile('missing.json', { default: true });
    expect(data).toEqual({ default: true });
    await driver.close();
  });

  it('writes and reads back', async () => {
    const driver = new MongoDriver({ uri, database: 'pulse_test' });
    await driver.init();
    await driver.writeJsonFileAtomic('foo.json', { x: 1 });
    const data = await driver.readJsonFile('foo.json', null);
    expect(data).toEqual({ x: 1 });
    await driver.close();
  });

  it('preserves full path in _id (no basename collision)', async () => {
    // CRITICAL regression test: pre-refactor, both paths collided as _id "flows".
    const driver = new MongoDriver({ uri, database: 'pulse_test' });
    await driver.init();
    await driver.writeJsonFileAtomic('projects/p1/flows.json', { project: 'p1' });
    await driver.writeJsonFileAtomic('projects/p2/flows.json', { project: 'p2' });
    const p1 = await driver.readJsonFile('projects/p1/flows.json', null);
    const p2 = await driver.readJsonFile('projects/p2/flows.json', null);
    expect(p1).toEqual({ project: 'p1' });
    expect(p2).toEqual({ project: 'p2' });
    await driver.close();
  });

  it('serializes concurrent writes via _version', async () => {
    const driver = new MongoDriver({ uri, database: 'pulse_test' });
    await driver.init();
    await driver.writeJsonFileAtomic('counter.json', { n: 0 });
    const tasks = Array.from({ length: 5 }, () =>
      driver.withFileLock('counter.json', async () => {
        const data = await driver.readJsonFile('counter.json', { n: 0 });
        await driver.writeJsonFileAtomic('counter.json', { n: data.n + 1 });
      })
    );
    await Promise.all(tasks);
    const final = await driver.readJsonFile('counter.json', null);
    expect(final.n).toBe(5);
    await driver.close();
  });

  it('exposes rawDb() for migration lock primitives', async () => {
    const driver = new MongoDriver({ uri, database: 'pulse_test' });
    await driver.init();
    const db = driver.rawDb();
    expect(db).toBeDefined();
    expect(db.databaseName).toBe('pulse_test');
    await driver.close();
  });
});
