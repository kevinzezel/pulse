import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const MANIFEST_REL = 'data/projects-manifest.json';

describe('moveProjectShards', () => {
  let tmpDir;
  let storage;
  let projectMove;
  let projectIndex;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pulse-move-'));
    mkdirSync(join(tmpDir, 'data'), { recursive: true });
    process.env.PULSE_FRONTEND_ROOT = tmpDir;
    vi.resetModules();

    storage = await import('../storage.js');
    projectMove = await import('../projectMove.js');
    projectIndex = await import('../projectIndex.js');
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

  it('does NOT write a .moved.json marker on the source', async () => {
    await storage.writeStoreToBackend('local', 'data/projects/p1/flows.json', { flows: [] });
    await projectMove.moveProjectShards('p1', 'local', 'b-second', { toBackendName: 'Second' });

    const marker = await storage.readStoreFromBackend('local', 'data/projects/p1/.moved.json', null);
    expect(marker).toBeNull();
  });

  it('deletes the source shards', async () => {
    await storage.writeStoreToBackend('local', 'data/projects/p1/flows.json', { flows: [] });
    await projectMove.moveProjectShards('p1', 'local', 'b-second');

    const sourceFlows = await storage.readStoreFromBackend('local', 'data/projects/p1/flows.json', null);
    expect(sourceFlows).toBeNull();
  });

  it('cleans up a pre-existing legacy .moved.json marker', async () => {
    await storage.writeStoreToBackend('local', 'data/projects/p1/flows.json', { flows: [] });
    // Simulate a 4.2.x install that left a marker behind.
    await storage.writeStoreToBackend('local', 'data/projects/p1/.moved.json', {
      v: 1,
      project_id: 'p1',
      moved_to_backend_id: 'somewhere',
    });

    await projectMove.moveProjectShards('p1', 'local', 'b-second');

    const marker = await storage.readStoreFromBackend('local', 'data/projects/p1/.moved.json', null);
    expect(marker).toBeNull();
  });

  it('updates the canonical data/projects-manifest.json on both backends', async () => {
    await storage.writeStoreToBackend('local', MANIFEST_REL, { v: 1, projects: [{ id: 'p1', name: 'X' }] });
    await storage.writeStoreToBackend('b-second', MANIFEST_REL, { v: 1, projects: [] });
    await storage.writeStoreToBackend('local', 'data/projects/p1/flows.json', { flows: [] });

    await projectMove.moveProjectShards('p1', 'local', 'b-second', { name: 'X' });

    const sourceManifest = await storage.readStoreFromBackend('local', MANIFEST_REL, null);
    expect(sourceManifest.projects).toHaveLength(0);
    const destManifest = await storage.readStoreFromBackend('b-second', MANIFEST_REL, null);
    expect(destManifest.projects).toHaveLength(1);
    expect(destManifest.projects[0].id).toBe('p1');
  });

  it('regression: after a local -> file-backed move, listAllProjects returns exactly one entry on the destination', async () => {
    // Seed the canonical manifest on `local` and one shard so the move has
    // something to copy. The destination starts empty.
    await storage.writeStoreToBackend('local', MANIFEST_REL, {
      v: 1,
      projects: [{ id: 'p1', name: 'P1', created_at: '2024-01-01T00:00:00Z' }],
    });
    await storage.writeStoreToBackend('local', 'data/projects/p1/flows.json', { flows: [] });

    await projectMove.moveProjectShards('p1', 'local', 'b-second', { name: 'P1' });

    const all = await projectIndex.listAllProjects();
    const matches = all.filter((p) => p.id === 'p1');
    expect(matches).toHaveLength(1);
    expect(matches[0].backend_id).toBe('b-second');
  });
});
