import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('projectIndex', () => {
  let tmpDir;
  let storage;
  let projectIndex;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pulse-projidx-'));
    mkdirSync(join(tmpDir, 'data'), { recursive: true });
    process.env.PULSE_FRONTEND_ROOT = tmpDir;
    vi.resetModules();

    // Seed v3 storage-config so the v4.2 reconciler considers it done.
    writeFileSync(join(tmpDir, 'data', 'storage-config.json'), JSON.stringify({
      v: 3,
      backends: [
        { id: 'local', name: 'Local', driver: 'file', config: {} },
        { id: 'b-1', name: 'Other', driver: 'file', config: { dataDir: join(tmpDir, 'data-b1') } },
      ],
      default_backend_id: 'local',
    }));
    mkdirSync(join(tmpDir, 'data-b1'), { recursive: true });

    storage = await import('../storage.js');
    projectIndex = await import('../projectIndex.js');
    await storage.resetForTests();

    // Re-seed config after resetForTests cleared the file.
    writeFileSync(join(tmpDir, 'data', 'storage-config.json'), JSON.stringify({
      v: 3,
      backends: [
        { id: 'local', name: 'Local', driver: 'file', config: {} },
        { id: 'b-1', name: 'Other', driver: 'file', config: { dataDir: join(tmpDir, 'data-b1') } },
      ],
      default_backend_id: 'local',
    }));
  });

  afterEach(async () => {
    if (storage) await storage.resetForTests();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('listAllProjects returns empty array when no manifest exists', async () => {
    const list = await projectIndex.listAllProjects();
    expect(list).toEqual([]);
  });

  it('addProjectToManifest creates an entry on a fresh backend', async () => {
    await projectIndex.addProjectToManifest('local', {
      id: 'p1', name: 'Project One', created_at: '2024-01-01T00:00:00Z',
    });
    const list = await projectIndex.listAllProjects();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'p1', name: 'Project One', backend_id: 'local' });
    expect(list[0].created_at).toBe('2024-01-01T00:00:00Z');
    expect(list[0].updated_at).toBeDefined();
  });

  it('addProjectToManifest is upsert: matching id triggers a name update', async () => {
    await projectIndex.addProjectToManifest('local', { id: 'p1', name: 'Old Name' });
    const before = await projectIndex.listAllProjects();
    expect(before[0].name).toBe('Old Name');
    const oldCreatedAt = before[0].created_at;

    // Tiny delay so updated_at changes meaningfully.
    await new Promise((r) => setTimeout(r, 5));

    await projectIndex.addProjectToManifest('local', { id: 'p1', name: 'New Name' });
    const after = await projectIndex.listAllProjects();
    expect(after).toHaveLength(1);
    expect(after[0].name).toBe('New Name');
    expect(after[0].created_at).toBe(oldCreatedAt);
    expect(after[0].updated_at).not.toBe(oldCreatedAt);
  });

  it('listAllProjects aggregates entries from multiple backends', async () => {
    await projectIndex.addProjectToManifest('local', { id: 'p1', name: 'Local Project' });
    await projectIndex.addProjectToManifest('b-1', { id: 'p2', name: 'Remote Project' });

    const list = await projectIndex.listAllProjects();
    expect(list).toHaveLength(2);
    const byId = Object.fromEntries(list.map((p) => [p.id, p]));
    expect(byId.p1.backend_id).toBe('local');
    expect(byId.p2.backend_id).toBe('b-1');
  });

  it('findProjectBackend returns the right id', async () => {
    await projectIndex.addProjectToManifest('local', { id: 'p1', name: 'A' });
    await projectIndex.addProjectToManifest('b-1', { id: 'p2', name: 'B' });

    expect(await projectIndex.findProjectBackend('p1')).toBe('local');
    expect(await projectIndex.findProjectBackend('p2')).toBe('b-1');
  });

  it('findProjectBackend returns null for unknown id', async () => {
    await projectIndex.addProjectToManifest('local', { id: 'p1', name: 'A' });
    expect(await projectIndex.findProjectBackend('does-not-exist')).toBe(null);
  });

  it('removeProjectFromManifest filters the entry out', async () => {
    await projectIndex.addProjectToManifest('local', { id: 'p1', name: 'Keep' });
    await projectIndex.addProjectToManifest('local', { id: 'p2', name: 'Drop' });

    await projectIndex.removeProjectFromManifest('local', 'p2');
    const list = await projectIndex.listAllProjects();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('p1');
  });

  it('removeProjectFromManifest is a no-op when the entry is absent', async () => {
    await projectIndex.addProjectToManifest('local', { id: 'p1', name: 'A' });
    await projectIndex.removeProjectFromManifest('local', 'unknown-id');
    const list = await projectIndex.listAllProjects();
    expect(list).toHaveLength(1);
  });
});
