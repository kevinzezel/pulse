import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { FileDriver } from '../jsonStore.js';

describe('FileDriver', () => {
  let tmpDir;
  let driver;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pulse-filedriver-'));
    driver = new FileDriver({ dataDir: tmpDir });
    await driver.init();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns fallback when file does not exist', async () => {
    const data = await driver.readJsonFile('missing.json', { default: true });
    expect(data).toEqual({ default: true });
  });

  it('writes and reads back JSON', async () => {
    await driver.writeJsonFileAtomic('foo.json', { hello: 'world' });
    const data = await driver.readJsonFile('foo.json', null);
    expect(data).toEqual({ hello: 'world' });
  });

  it('creates nested directories on write', async () => {
    await driver.writeJsonFileAtomic('projects/abc/flows.json', { flows: [] });
    const data = await driver.readJsonFile('projects/abc/flows.json', null);
    expect(data).toEqual({ flows: [] });
  });

  it('serializes concurrent writes with withFileLock', async () => {
    await driver.writeJsonFileAtomic('counter.json', { n: 0 });
    const tasks = Array.from({ length: 10 }, () =>
      driver.withFileLock('counter.json', async () => {
        const data = await driver.readJsonFile('counter.json', { n: 0 });
        await new Promise(r => setTimeout(r, 5));
        await driver.writeJsonFileAtomic('counter.json', { n: data.n + 1 });
      })
    );
    await Promise.all(tasks);
    const final = await driver.readJsonFile('counter.json', null);
    expect(final.n).toBe(10);
  });

  it('two FileDriver instances with same dataDir share state', async () => {
    const d2 = new FileDriver({ dataDir: tmpDir });
    await d2.init();
    await driver.writeJsonFileAtomic('shared.json', { x: 1 });
    const data = await d2.readJsonFile('shared.json', null);
    expect(data).toEqual({ x: 1 });
  });

  it('deleteFile removes the file and returns true', async () => {
    await driver.writeJsonFileAtomic('temp.json', { x: 1 });
    expect(await driver.deleteFile('temp.json')).toBe(true);
    const data = await driver.readJsonFile('temp.json', null);
    expect(data).toBe(null);
  });

  it('deleteFile returns false when file does not exist', async () => {
    expect(await driver.deleteFile('nonexistent.json')).toBe(false);
  });

  it('writeBinaryFileAtomic + readBinaryFile round-trip preserves bytes', async () => {
    const buf = Buffer.from([0xff, 0x00, 0x10, 0x42, 0xde, 0xad, 0xbe, 0xef]);
    await driver.writeBinaryFileAtomic('attachments/a1/blob.bin', buf, { contentType: 'application/octet-stream' });
    const result = await driver.readBinaryFile('attachments/a1/blob.bin');
    expect(result).not.toBeNull();
    expect(Buffer.compare(result.buffer, buf)).toBe(0);
    // FileDriver does not persist contentType -- it only round-trips via S3.
    expect(result.contentType).toBeUndefined();
  });

  it('readBinaryFile returns null when the file does not exist', async () => {
    const result = await driver.readBinaryFile('attachments/missing/blob.bin');
    expect(result).toBeNull();
  });

  it('deletePrefix removes every file under the prefix recursively', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    await driver.writeBinaryFileAtomic('projects/p1/attachments/a1/img.png', png);
    await driver.writeBinaryFileAtomic('projects/p1/attachments/a2/doc.pdf', png);
    await driver.writeJsonFileAtomic('projects/p1/task-attachments.json', { attachments: [] });
    // A sibling project that must NOT be touched -- the prefix is project-scoped.
    await driver.writeBinaryFileAtomic('projects/p2/attachments/a3/other.png', png);

    const removed = await driver.deletePrefix('projects/p1/attachments');
    expect(removed).toBe(true);

    expect(await driver.readBinaryFile('projects/p1/attachments/a1/img.png')).toBeNull();
    expect(await driver.readBinaryFile('projects/p1/attachments/a2/doc.pdf')).toBeNull();
    // Sibling project untouched.
    expect(await driver.readBinaryFile('projects/p2/attachments/a3/other.png')).not.toBeNull();
    // Sibling JSON in same project untouched (different prefix).
    const j = await driver.readJsonFile('projects/p1/task-attachments.json', null);
    expect(j).toEqual({ attachments: [] });
  });

  it('deletePrefix is idempotent when the prefix does not exist', async () => {
    expect(await driver.deletePrefix('does/not/exist')).toBe(false);
  });

  it('withFileLock serializes across two instances on the same dataDir', async () => {
    // Regression guard: if _locks were moved to instance state (this._locks),
    // two drivers on the same dataDir would race. The module-level Map keyed
    // by `${dataDir}::${relPath}` is what makes cross-instance serialization
    // possible — Task 5's registry relies on this.
    const d2 = new FileDriver({ dataDir: tmpDir });
    await d2.init();
    await driver.writeJsonFileAtomic('counter.json', { n: 0 });

    const incOn = (d) => d.withFileLock('counter.json', async () => {
      const data = await d.readJsonFile('counter.json', { n: 0 });
      await new Promise(r => setTimeout(r, 5));
      await d.writeJsonFileAtomic('counter.json', { n: data.n + 1 });
    });

    const tasks = [];
    for (let i = 0; i < 10; i++) {
      tasks.push(incOn(i % 2 === 0 ? driver : d2));
    }
    await Promise.all(tasks);
    const final = await driver.readJsonFile('counter.json', null);
    expect(final.n).toBe(10);
  });
});
