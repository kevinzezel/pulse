import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('moveProjectShards', () => {
  let tmpDir;
  let storage;
  let projectMove;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pulse-move-'));
    mkdirSync(join(tmpDir, 'data'), { recursive: true });
    process.env.PULSE_FRONTEND_ROOT = tmpDir;
    vi.resetModules();

    storage = await import('../storage.js');
    projectMove = await import('../projectMove.js');
    await storage.resetForTests();

    // v2 config with two file backends — `local` (default dataDir) and
    // `b-second` (custom dataDir). Both file driver so we can use real I/O.
    // Written AFTER resetForTests() because reset unlinks storage-config.json,
    // and BEFORE getConfig() so the v2 shape short-circuits the migrator.
    writeFileSync(join(tmpDir, 'data', 'storage-config.json'), JSON.stringify({
      v: 2,
      backends: [
        { id: 'local', name: 'Local', driver: 'file', config: {} },
        { id: 'b-second', name: 'Second', driver: 'file', config: { dataDir: join(tmpDir, 'second') } },
      ],
      default_backend_id: 'local',
    }));
  });

  afterEach(async () => {
    if (storage) await storage.resetForTests();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('copies all populated per-project shards from source to dest', async () => {
    await storage.writeStoreToBackend('local', 'data/projects/p1/flows.json', { flows: [{ id: 'f1' }] });
    await storage.writeStoreToBackend('local', 'data/projects/p1/notes.json', { notes: [{ id: 'n1' }] });

    const result = await projectMove.moveProjectShards('p1', 'local', 'b-second');
    expect(result.copied).toBeGreaterThanOrEqual(2);

    const destFlows = await storage.readStoreFromBackend('b-second', 'data/projects/p1/flows.json', null);
    expect(destFlows).toEqual({ flows: [{ id: 'f1' }] });
    const destNotes = await storage.readStoreFromBackend('b-second', 'data/projects/p1/notes.json', null);
    expect(destNotes).toEqual({ notes: [{ id: 'n1' }] });
  });

  it('writes .moved.json redirect marker on the source after copy', async () => {
    await storage.writeStoreToBackend('local', 'data/projects/p1/flows.json', { flows: [] });
    await projectMove.moveProjectShards('p1', 'local', 'b-second', { toBackendName: 'Second' });

    const marker = await storage.readStoreFromBackend('local', 'data/projects/p1/.moved.json', null);
    expect(marker).toBeDefined();
    expect(marker.moved_to_backend_id).toBe('b-second');
    expect(marker.moved_to_backend_name).toBe('Second');
    expect(typeof marker.moved_at).toBe('string');
  });

  it('deletes the source shards (but keeps the .moved.json marker)', async () => {
    await storage.writeStoreToBackend('local', 'data/projects/p1/flows.json', { flows: [] });
    await projectMove.moveProjectShards('p1', 'local', 'b-second');

    const sourceFlows = await storage.readStoreFromBackend('local', 'data/projects/p1/flows.json', null);
    expect(sourceFlows).toBeNull();
    const marker = await storage.readStoreFromBackend('local', 'data/projects/p1/.moved.json', null);
    expect(marker).not.toBeNull();
  });

  it('updates manifests on both backends', async () => {
    await storage.writeStoreToBackend('local', 'projects-manifest.json', { v: 1, projects: [{ id: 'p1', name: 'X' }] });
    await storage.writeStoreToBackend('b-second', 'projects-manifest.json', { v: 1, projects: [] });
    await storage.writeStoreToBackend('local', 'data/projects/p1/flows.json', { flows: [] });

    await projectMove.moveProjectShards('p1', 'local', 'b-second', { name: 'X' });

    const sourceManifest = await storage.readStoreFromBackend('local', 'projects-manifest.json', null);
    expect(sourceManifest.projects).toHaveLength(0);
    const destManifest = await storage.readStoreFromBackend('b-second', 'projects-manifest.json', null);
    expect(destManifest.projects).toHaveLength(1);
    expect(destManifest.projects[0].id).toBe('p1');
  });
});
