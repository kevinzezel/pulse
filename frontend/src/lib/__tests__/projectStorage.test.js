import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('projectStorage', () => {
  let tmpDir;
  let projectStorage;
  let storage;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pulse-projstor-'));
    mkdirSync(join(tmpDir, 'data'), { recursive: true });
    process.env.PULSE_FRONTEND_ROOT = tmpDir;
    vi.resetModules();

    // Seed v2 storage-config + projects.json
    writeFileSync(join(tmpDir, 'data', 'storage-config.json'), JSON.stringify({
      v: 2,
      backends: [{ id: 'local', name: 'Local', driver: 'file', config: {} }],
      default_backend_id: 'local',
    }));
    writeFileSync(join(tmpDir, 'data', 'projects.json'), JSON.stringify({
      projects: [
        { id: 'p1', name: 'P1', storage_ref: 'local' },
        { id: 'p2', name: 'P2', storage_ref: 'local' },
      ],
      active_project_id: 'p1',
    }));

    storage = await import('../storage.js');
    projectStorage = await import('../projectStorage.js');
    await storage.resetForTests();
  });

  afterEach(async () => {
    if (storage) await storage.resetForTests();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('resolveProjectStorage returns backend id for known project', async () => {
    const ref = await projectStorage.resolveProjectStorage('p1');
    expect(ref).toBe('local');
  });

  it('resolveProjectStorage throws for unknown project', async () => {
    await expect(projectStorage.resolveProjectStorage('does-not-exist'))
      .rejects.toThrow(/unknown project/i);
  });

  it('readProjectFile routes to projects/<id>/<file> and returns fallback when missing', async () => {
    const data = await projectStorage.readProjectFile('p1', 'flows.json', { flows: [] });
    expect(data).toEqual({ flows: [] });
  });

  it('writeProjectFile writes to projects/<id>/<file>', async () => {
    await projectStorage.writeProjectFile('p1', 'flows.json', { flows: [{ id: 'f1' }] });
    const data = await projectStorage.readProjectFile('p1', 'flows.json', null);
    expect(data).toEqual({ flows: [{ id: 'f1' }] });
  });

  it('withProjectLock serializes concurrent mutations on same project+file', async () => {
    await projectStorage.writeProjectFile('p1', 'counter.json', { n: 0 });
    const tasks = Array.from({ length: 10 }, () =>
      projectStorage.withProjectLock('p1', 'counter.json', async () => {
        const cur = await projectStorage.readProjectFile('p1', 'counter.json', { n: 0 });
        await new Promise(r => setTimeout(r, 5));
        await projectStorage.writeProjectFile('p1', 'counter.json', { n: cur.n + 1 });
      })
    );
    await Promise.all(tasks);
    const final = await projectStorage.readProjectFile('p1', 'counter.json', null);
    expect(final.n).toBe(10);
  });

  it('two different projects do not share lock state', async () => {
    await projectStorage.writeProjectFile('p1', 'data.json', { project: 'p1' });
    await projectStorage.writeProjectFile('p2', 'data.json', { project: 'p2' });
    const a = await projectStorage.readProjectFile('p1', 'data.json', null);
    const b = await projectStorage.readProjectFile('p2', 'data.json', null);
    expect(a.project).toBe('p1');
    expect(b.project).toBe('p2');
  });

  it('validateGroupBelongsToProject rejects groups stamped for another project', async () => {
    await projectStorage.writeProjectFile('p1', 'task-board-groups.json', {
      groups: [
        { id: 'same-project', project_id: 'p1' },
        { id: 'legacy-no-project' },
        { id: 'other-project', project_id: 'p2' },
      ],
    });

    await expect(projectStorage.validateGroupBelongsToProject('p1', 'task-board-groups.json', 'same-project'))
      .resolves.toBe(null);
    await expect(projectStorage.validateGroupBelongsToProject('p1', 'task-board-groups.json', 'legacy-no-project'))
      .resolves.toBe(null);
    const err = await projectStorage.validateGroupBelongsToProject('p1', 'task-board-groups.json', 'other-project');
    expect(err.detailKey).toBe('errors.group_not_in_project');
  });

  it('readGlobalFile reads from local backend at globals/<file>', async () => {
    await projectStorage.writeGlobalFile('prompts.json', { prompts: [{ id: 'g1' }] });
    const data = await projectStorage.readGlobalFile('prompts.json', null);
    expect(data).toEqual({ prompts: [{ id: 'g1' }] });
  });

  it('withGlobalLock serializes mutations on the same global file', async () => {
    await projectStorage.writeGlobalFile('counter.json', { n: 0 });
    const tasks = Array.from({ length: 5 }, () =>
      projectStorage.withGlobalLock('counter.json', async () => {
        const cur = await projectStorage.readGlobalFile('counter.json', { n: 0 });
        // Force an event-loop yield so the read-modify-write race is sharp:
        // without serialization, parallel reads would all see the same n.
        await new Promise(r => setTimeout(r, 5));
        await projectStorage.writeGlobalFile('counter.json', { n: cur.n + 1 });
      })
    );
    await Promise.all(tasks);
    const final = await projectStorage.readGlobalFile('counter.json', null);
    expect(final.n).toBe(5);
  });
});
