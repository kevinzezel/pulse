import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('readLocalStore / writeLocalStore route to backend "local"', () => {
  let tmpDir;
  let projectStorage;
  let storage;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pulse-local-'));
    mkdirSync(join(tmpDir, 'data'), { recursive: true });
    process.env.PULSE_FRONTEND_ROOT = tmpDir;
    vi.resetModules();

    // Seed v2 storage-config with a fake "remote" backend marked as DEFAULT —
    // readLocalStore must still hit the local file (not the default backend).
    writeFileSync(join(tmpDir, 'data', 'storage-config.json'), JSON.stringify({
      v: 2,
      backends: [
        { id: 'local', name: 'Local', driver: 'file', config: {} },
        // We don't actually configure a real S3/Mongo here — declaring it as
        // default with a `file` driver is enough to detect routing mistakes:
        // if readLocalStore wrongly went through the default backend, the file
        // would land at a different prefix (covered by the file-content
        // assertions below).
        { id: 'b-fake-default', name: 'fake', driver: 'file', config: {} },
      ],
      default_backend_id: 'b-fake-default',
    }));

    storage = await import('../storage.js');
    projectStorage = await import('../projectStorage.js');
    await storage.resetForTests();
  });

  afterEach(async () => {
    if (storage) await storage.resetForTests();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writeLocalStore writes to the local backend even when default is something else', async () => {
    await projectStorage.writeLocalStore('data/projects.json', {
      projects: [{ id: 'p1', name: 'Test' }],
    });
    // The local FileDriver writes to <frontend_root>/data/projects.json.
    const data = JSON.parse(readFileSync(join(tmpDir, 'data', 'projects.json'), 'utf-8'));
    expect(data.projects[0].id).toBe('p1');
  });

  it('readLocalStore reads from the local backend even when default is something else', async () => {
    writeFileSync(join(tmpDir, 'data', 'foo.json'), JSON.stringify({ hello: 'world' }));
    const data = await projectStorage.readLocalStore('data/foo.json', null);
    expect(data).toEqual({ hello: 'world' });
  });

  it('withLocalStoreLock serializes mutations on the local backend', async () => {
    await projectStorage.writeLocalStore('data/counter.json', { n: 0 });
    const tasks = Array.from({ length: 5 }, () =>
      projectStorage.withLocalStoreLock('data/counter.json', async () => {
        const cur = await projectStorage.readLocalStore('data/counter.json', { n: 0 });
        await new Promise(r => setTimeout(r, 5));
        await projectStorage.writeLocalStore('data/counter.json', { n: cur.n + 1 });
      })
    );
    await Promise.all(tasks);
    const final = await projectStorage.readLocalStore('data/counter.json', null);
    expect(final.n).toBe(5);
  });
});
