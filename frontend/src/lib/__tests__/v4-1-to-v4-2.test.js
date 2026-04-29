import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { vi } from 'vitest';

describe('v4.1 -> v4.2 reconciler', () => {
  let tmpDir;
  let dataDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pulse-v42-'));
    dataDir = join(tmpDir, 'data');
    mkdirSync(dataDir, { recursive: true });
    process.env.PULSE_FRONTEND_ROOT = tmpDir;
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.PULSE_FRONTEND_ROOT;
  });

  function writeData(name, value) {
    writeFileSync(join(dataDir, name), JSON.stringify(value, null, 2));
  }

  function readData(rel) {
    return JSON.parse(readFileSync(join(dataDir, rel), 'utf-8'));
  }

  it('no-op when storage-config is not v:2 (e.g. already v:3)', async () => {
    writeData('storage-config.json', {
      v: 3,
      backends: [{ id: 'local', name: 'Local', driver: 'file', config: {} }],
      default_backend_id: 'local',
    });
    const { migrate } = await import('../migrations/v4-1-to-v4-2.js');
    const result = await migrate();
    expect(result.ran).toBe(false);
    expect(result.reason).toBe('not-v2');
  });

  it('reconciles legacy projects.json into local manifest, writes prefs, renames legacy, bumps to v:3', async () => {
    writeData('storage-config.json', {
      v: 2,
      backends: [{ id: 'local', name: 'Local', driver: 'file', config: {} }],
      default_backend_id: 'local',
    });
    writeData('projects.json', {
      projects: [
        {
          id: 'p1', name: 'Site', is_default: true, created_at: '2024-01-01T00:00:00Z',
          storage_ref: 'local',
        },
        {
          id: 'p2', name: 'API', is_default: false, created_at: '2024-02-01T00:00:00Z',
          storage_ref: 'local',
        },
      ],
      active_project_id: 'p2',
    });

    const { migrate } = await import('../migrations/v4-1-to-v4-2.js');
    const result = await migrate();

    expect(result.ran).toBe(true);

    // Manifest is written at `data/projects-manifest.json` (relative to the
    // file driver's dataDir = PULSE_FRONTEND_ROOT). 4.2.1 moved it inside
    // `data/` so it sits next to the rest of the dashboard's data instead
    // of polluting the install root.
    const manifest = JSON.parse(readFileSync(join(dataDir, 'projects-manifest.json'), 'utf-8'));
    expect(manifest.v).toBe(1);
    expect(manifest.projects).toHaveLength(2);
    const ids = manifest.projects.map((p) => p.id).sort();
    expect(ids).toEqual(['p1', 'p2']);
    const p1 = manifest.projects.find((p) => p.id === 'p1');
    expect(p1.created_at).toBe('2024-01-01T00:00:00Z');
    expect(p1.updated_at).toBeDefined();

    // Prefs file written.
    const prefs = readData('project-prefs.json');
    expect(prefs.default_project_id).toBe('p1');
    expect(prefs.active_project_id).toBe('p2');

    // Legacy file renamed to sidecar.
    expect(existsSync(join(dataDir, 'projects.json'))).toBe(false);
    expect(existsSync(join(dataDir, 'projects.json.legacy-pre-v4.2'))).toBe(true);

    // Config bumped to v:3.
    const cfg = readData('storage-config.json');
    expect(cfg.v).toBe(3);
    expect(cfg.default_backend_id).toBe('local');
  });

  it('routes orphan storage_ref (unknown backend) to local', async () => {
    writeData('storage-config.json', {
      v: 2,
      backends: [{ id: 'local', name: 'Local', driver: 'file', config: {} }],
      default_backend_id: 'local',
    });
    writeData('projects.json', {
      projects: [
        { id: 'orphan', name: 'Orphan', storage_ref: 'b-vanished', created_at: '2024-03-01T00:00:00Z' },
      ],
      active_project_id: 'orphan',
    });

    const { migrate } = await import('../migrations/v4-1-to-v4-2.js');
    const result = await migrate();
    expect(result.ran).toBe(true);

    const manifest = JSON.parse(readFileSync(join(dataDir, 'projects-manifest.json'), 'utf-8'));
    expect(manifest.projects).toHaveLength(1);
    expect(manifest.projects[0].id).toBe('orphan');
  });

  it('writes empty prefs and bumps config when projects.json is absent (fresh install)', async () => {
    writeData('storage-config.json', {
      v: 2,
      backends: [{ id: 'local', name: 'Local', driver: 'file', config: {} }],
      default_backend_id: 'local',
    });

    const { migrate } = await import('../migrations/v4-1-to-v4-2.js');
    const result = await migrate();

    expect(result.ran).toBe(true);
    const prefs = readData('project-prefs.json');
    expect(prefs).toEqual({ active_project_id: null, default_project_id: null });
    const cfg = readData('storage-config.json');
    expect(cfg.v).toBe(3);
  });

  it('idempotent across re-runs: second call short-circuits', async () => {
    writeData('storage-config.json', {
      v: 2,
      backends: [{ id: 'local', name: 'Local', driver: 'file', config: {} }],
      default_backend_id: 'local',
    });
    writeData('projects.json', {
      projects: [{ id: 'p1', name: 'A', is_default: true }],
      active_project_id: 'p1',
    });

    const { migrate } = await import('../migrations/v4-1-to-v4-2.js');
    const first = await migrate();
    expect(first.ran).toBe(true);
    const second = await migrate();
    expect(second.ran).toBe(false);
    expect(second.reason).toBe('not-v2');
  });

  it('falls back to default_project_id when legacy active_project_id is missing', async () => {
    writeData('storage-config.json', {
      v: 2,
      backends: [{ id: 'local', name: 'Local', driver: 'file', config: {} }],
      default_backend_id: 'local',
    });
    writeData('projects.json', {
      projects: [{ id: 'p1', name: 'X', is_default: true }],
    });

    const { migrate } = await import('../migrations/v4-1-to-v4-2.js');
    await migrate();
    const prefs = readData('project-prefs.json');
    expect(prefs.default_project_id).toBe('p1');
    expect(prefs.active_project_id).toBe('p1');
  });
});
