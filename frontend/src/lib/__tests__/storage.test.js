import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('storage registry', () => {
  let tmpDir;
  let storage;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pulse-storage-'));
    mkdirSync(join(tmpDir, 'data'), { recursive: true });
    process.env.PULSE_FRONTEND_ROOT = tmpDir;
    vi.resetModules();
    storage = await import('../storage.js');
    await storage.resetForTests();
  });

  afterEach(async () => {
    if (storage) await storage.resetForTests();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('initializes with default file backend when no config', async () => {
    const config = await storage.getConfig();
    expect(config.default_backend_id).toBe('local');
    expect(config.backends.find(b => b.id === 'local')).toBeDefined();
    // v:2 is the v4.0 marker, v:3 is post-v4.2-reconciler. Both are valid
    // shapes and the reader treats them identically; on a fresh empty
    // install the v4.1->v4.2 reconciler runs and bumps to v:3.
    expect([2, 3]).toContain(config.v);
  });

  it('caches driver Promise (no race on concurrent getDriverFor)', async () => {
    let initCount = 0;
    storage._setDriverFactoryForTests('file', () => ({
      init: async () => { initCount++; await new Promise(r => setTimeout(r, 10)); },
      readJsonFile: async (rel, fallback) => fallback,
      close: async () => {},
    }));

    const [d1, d2, d3] = await Promise.all([
      storage.getDriverFor('local'),
      storage.getDriverFor('local'),
      storage.getDriverFor('local'),
    ]);

    expect(d1).toBe(d2);
    expect(d2).toBe(d3);
    expect(initCount).toBe(1);
  });

  it('compat layer routes readStore(relPath) to default backend', async () => {
    await storage.writeStore('foo.json', { hello: 'world' });
    const data = await storage.readStore('foo.json', null);
    expect(data).toEqual({ hello: 'world' });
  });

  it('addBackend appends to config and persists with UUID id', async () => {
    const newId = await storage.addBackend({
      name: 'Test S3',
      driver: 's3',
      config: { bucket: 'b', region: 'us-east-1', access_key_id: 'k', secret_access_key: 's' },
    });
    expect(newId).toMatch(/^b-/);
    const cfg = await storage.getConfig();
    expect(cfg.backends.find(b => b.id === newId)).toBeDefined();
    expect(cfg.backends.find(b => b.id === newId).name).toBe('Test S3');
  });

  it('cannot remove local backend', async () => {
    await expect(storage.removeBackend('local')).rejects.toThrow(/local/i);
  });

  it('cannot remove default backend (must change default first)', async () => {
    const newId = await storage.addBackend({
      name: 'X',
      driver: 's3',
      config: { bucket: 'b', region: 'us-east-1', access_key_id: 'k', secret_access_key: 's' },
    });
    await storage.setDefaultBackend(newId);
    await expect(storage.removeBackend(newId)).rejects.toThrow(/default/i);
  });

  it('init failure removes Promise from cache so retry can succeed', async () => {
    let attempt = 0;
    storage._setDriverFactoryForTests('file', () => ({
      init: async () => {
        attempt++;
        if (attempt === 1) throw new Error('first attempt fails');
      },
      readJsonFile: async () => null,
      close: async () => {},
    }));

    await expect(storage.getDriverFor('local')).rejects.toThrow(/first attempt fails/);
    // Second call should retry, not return cached failed Promise
    const driver = await storage.getDriverFor('local');
    expect(driver).toBeDefined();
    expect(attempt).toBe(2);
  });

  it('runs migrations on first getConfig call (v1 file -> v2)', async () => {
    // Seed v1 config
    writeFileSync(join(tmpDir, 'data', 'storage-config.json'), JSON.stringify({ driver: 'file' }));

    // Reset modules so storage.js picks up the freshly-seeded file
    vi.resetModules();
    storage = await import('../storage.js');

    const cfg = await storage.getConfig();
    // v:2 (post-v3->v4) or v:3 (post-v4.1->v4.2) -- both are valid shapes
    // depending on whether the v4.2 reconciler ran on this fresh install.
    expect([2, 3]).toContain(cfg.v);
    expect(cfg.default_backend_id).toBe('local');
    expect(cfg.backends.find(b => b.id === 'local')).toBeDefined();
  });
});
