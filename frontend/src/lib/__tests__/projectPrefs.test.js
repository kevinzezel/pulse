import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('projectPrefs', () => {
  let tmpDir;
  let storage;
  let prefs;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pulse-prefs-'));
    mkdirSync(join(tmpDir, 'data'), { recursive: true });
    process.env.PULSE_FRONTEND_ROOT = tmpDir;
    vi.resetModules();

    // Seed v3 config so migrations don't trip up.
    writeFileSync(join(tmpDir, 'data', 'storage-config.json'), JSON.stringify({
      v: 3,
      backends: [{ id: 'local', name: 'Local', driver: 'file', config: {} }],
      default_backend_id: 'local',
    }));

    storage = await import('../storage.js');
    prefs = await import('../projectPrefs.js');
    await storage.resetForTests();
    writeFileSync(join(tmpDir, 'data', 'storage-config.json'), JSON.stringify({
      v: 3,
      backends: [{ id: 'local', name: 'Local', driver: 'file', config: {} }],
      default_backend_id: 'local',
    }));
  });

  afterEach(async () => {
    if (storage) await storage.resetForTests();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('readProjectPrefs returns null defaults when file is missing', async () => {
    const p = await prefs.readProjectPrefs();
    expect(p).toEqual({ active_project_id: null, default_project_id: null });
  });

  it('setActiveProjectPref/readProjectPrefs roundtrip', async () => {
    await prefs.setActiveProjectPref('p1');
    const p = await prefs.readProjectPrefs();
    expect(p.active_project_id).toBe('p1');
    expect(p.default_project_id).toBe(null);
  });

  it('setDefaultProjectPref/readProjectPrefs roundtrip', async () => {
    await prefs.setDefaultProjectPref('p2');
    const p = await prefs.readProjectPrefs();
    expect(p.default_project_id).toBe('p2');
    expect(p.active_project_id).toBe(null);
  });

  it('setActive then setDefault preserves the other field', async () => {
    await prefs.setActiveProjectPref('p1');
    await prefs.setDefaultProjectPref('p2');
    const p = await prefs.readProjectPrefs();
    expect(p.active_project_id).toBe('p1');
    expect(p.default_project_id).toBe('p2');
  });

  it('null/empty input is normalized to null', async () => {
    await prefs.setActiveProjectPref('p1');
    await prefs.setActiveProjectPref('');
    const p = await prefs.readProjectPrefs();
    expect(p.active_project_id).toBe(null);
  });
});
