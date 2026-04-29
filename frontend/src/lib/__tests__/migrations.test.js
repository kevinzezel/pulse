import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, existsSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, GetObjectCommand, PutObjectCommand, HeadBucketCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { sdkStreamMixin } from '@smithy/util-stream';
import { Readable } from 'stream';

const stringStream = (text) => sdkStreamMixin(Readable.from([Buffer.from(text)]));

describe('v3 -> v4 migration -- Caso 1 (file local)', () => {
  let tmpDir;
  let dataDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pulse-mig-'));
    dataDir = join(tmpDir, 'data');
    mkdirSync(dataDir, { recursive: true });
    process.env.PULSE_FRONTEND_ROOT = tmpDir;
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.PULSE_FRONTEND_ROOT;
  });

  function seedV3(payload) {
    for (const [name, data] of Object.entries(payload)) {
      writeFileSync(join(dataDir, name), JSON.stringify(data));
    }
  }

  function readJson(rel) {
    return JSON.parse(readFileSync(join(dataDir, rel), 'utf-8'));
  }

  it('no-op when storage-config.json already v2', async () => {
    seedV3({
      'storage-config.json': {
        v: 2,
        backends: [{ id: 'local', name: 'Local', driver: 'file', config: {} }],
        default_backend_id: 'local',
      },
    });
    const { migrate } = await import('../migrations/v3-to-v4.js');
    const result = await migrate();
    expect(result.ran).toBe(false);
  });

  it('local-only install: re-shards into projects/ and globals/', async () => {
    seedV3({
      'projects.json': {
        projects: [
          { id: 'p1', name: 'Pulse Site' },
          { id: 'p2', name: 'Pulse API' },
        ],
        active_project_id: 'p1',
      },
      'flows.json': {
        flows: [
          { id: 'f1', name: 'Build', project_id: 'p1', content: '...' },
          { id: 'f2', name: 'Deploy', project_id: 'p2', content: '...' },
        ],
      },
      'notes.json': {
        notes: [
          { id: 'n1', title: 'A', project_id: 'p1' },
        ],
      },
      'prompts.json': {
        prompts: [
          { id: 'pr1', name: 'Refactor', project_id: 'p1', text: '...' },
          { id: 'pr2', name: 'Global helper', project_id: null, text: '...' },
        ],
      },
      'prompt-groups.json': {
        groups: [{ id: 'pg1', name: 'My group' }],
      },
    });
    const { migrate } = await import('../migrations/v3-to-v4.js');
    const result = await migrate();

    expect(result.ran).toBe(true);
    expect(result.case).toBe(1);

    const cfg = readJson('storage-config.json');
    expect(cfg.v).toBe(2);
    expect(cfg.default_backend_id).toBe('local');
    expect(cfg.backends).toHaveLength(1);
    expect(cfg.backends[0].id).toBe('local');

    // projects.json gained storage_ref
    const projects = readJson('projects.json');
    expect(projects.projects[0]).toMatchObject({ id: 'p1', storage_ref: 'local' });
    expect(projects.projects[1]).toMatchObject({ id: 'p2', storage_ref: 'local' });

    // Per-project shards
    const p1Flows = readJson('projects/p1/flows.json');
    expect(p1Flows.flows).toHaveLength(1);
    expect(p1Flows.flows[0].id).toBe('f1');

    const p2Flows = readJson('projects/p2/flows.json');
    expect(p2Flows.flows[0].id).toBe('f2');

    const p1Notes = readJson('projects/p1/notes.json');
    expect(p1Notes.notes).toHaveLength(1);

    const p1Prompts = readJson('projects/p1/prompts.json');
    expect(p1Prompts.prompts).toHaveLength(1);
    expect(p1Prompts.prompts[0].id).toBe('pr1');

    // Globals
    const globalPrompts = readJson('globals/prompts.json');
    expect(globalPrompts.prompts).toHaveLength(1);
    expect(globalPrompts.prompts[0].id).toBe('pr2');

    // prompt-groups: no project_id -> all become global with project_id: null
    const globalGroups = readJson('globals/prompt-groups.json');
    expect(globalGroups.groups).toHaveLength(1);
    expect(globalGroups.groups[0].project_id).toBe(null);

    // Backup created
    expect(existsSync(join(tmpDir, 'data.backup-pre-v4'))).toBe(true);

    // Auto-cleanup: per-project flat files should be gone post-migration.
    expect(existsSync(join(dataDir, 'flows.json'))).toBe(false);
    expect(existsSync(join(dataDir, 'notes.json'))).toBe(false);
    expect(existsSync(join(dataDir, 'prompts.json'))).toBe(false);
    expect(existsSync(join(dataDir, 'prompt-groups.json'))).toBe(false);
    // Per-install files remain (they're still local source of truth in v4).
    // (The seed didn't include them so we just confirm we didn't blow up.)
  });

  it('idempotent: running migration twice produces same state', async () => {
    seedV3({
      'projects.json': { projects: [{ id: 'p1', name: 'X' }], active_project_id: 'p1' },
      'flows.json': { flows: [{ id: 'f1', project_id: 'p1' }] },
    });
    const { migrate } = await import('../migrations/v3-to-v4.js');
    await migrate();
    const firstCfg = readJson('storage-config.json');
    const result = await migrate();
    expect(result.ran).toBe(false);
    const secondCfg = readJson('storage-config.json');
    expect(firstCfg).toEqual(secondCfg);
  });

  it('skips re-shard when projects/ already populated', async () => {
    seedV3({
      'storage-config.json': {
        v: 2,
        backends: [{ id: 'local', name: 'Local', driver: 'file', config: {} }],
        default_backend_id: 'local',
      },
      'projects.json': { projects: [{ id: 'p1', name: 'X', storage_ref: 'local' }], active_project_id: 'p1' },
    });
    mkdirSync(join(dataDir, 'projects', 'p1'), { recursive: true });
    writeFileSync(join(dataDir, 'projects', 'p1', 'flows.json'), JSON.stringify({ flows: [] }));
    const { migrate } = await import('../migrations/v3-to-v4.js');
    const result = await migrate();
    expect(result.ran).toBe(false);
  });

  it('handles empty install (no files at all)', async () => {
    const { migrate } = await import('../migrations/v3-to-v4.js');
    const result = await migrate();
    expect(result.ran).toBe(true);
    expect(result.case).toBe(1);
    const cfg = readJson('storage-config.json');
    expect(cfg.v).toBe(2);
    expect(cfg.default_backend_id).toBe('local');
  });
});

describe('v3 -> v4 migration -- Caso 2 (S3 active)', () => {
  let tmpDir;
  let dataDir;
  let s3Mock;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pulse-mig-s3-'));
    dataDir = join(tmpDir, 'data');
    mkdirSync(dataDir, { recursive: true });
    process.env.PULSE_FRONTEND_ROOT = tmpDir;
    s3Mock = mockClient(S3Client);
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.PULSE_FRONTEND_ROOT;
    s3Mock.restore();
  });

  function readJson(rel) {
    return JSON.parse(readFileSync(join(dataDir, rel), 'utf-8'));
  }

  it('imports v1 S3 config and writes parallel sharded layout', async () => {
    // Seed local v1 config pointing at S3
    writeFileSync(join(dataDir, 'storage-config.json'), JSON.stringify({
      driver: 's3',
      bucket: 'pulse-team',
      region: 'us-east-1',
      access_key_id: 'k',
      secret_access_key: 's',
      prefix: '',
    }));

    // Mock S3 setup
    s3Mock.on(HeadBucketCommand).resolves({});

    // aws-sdk-client-mock matcher precedence: wider matchers must be declared
    // FIRST so the more specific ones declared later take precedence.
    // Defaults first.
    s3Mock.on(GetObjectCommand).rejects({ name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
    s3Mock.on(PutObjectCommand).resolves({ ETag: '"new"' });
    s3Mock.on(DeleteObjectCommand).resolves({});

    // Migration lock -- IfNoneMatch succeeds first try
    s3Mock.on(PutObjectCommand, { Key: '.migrating-v4' }).resolves({ ETag: '"lock-1"' });

    // Old data on S3 (v1 flat layout)
    s3Mock.on(GetObjectCommand, { Key: 'projects.json' }).resolves({
      Body: stringStream(JSON.stringify({
        projects: [
          { id: 'p1', name: 'Site' },
          { id: 'p2', name: 'API' },
        ],
        active_project_id: 'p1',
      })),
      ETag: '"e"',
    });
    s3Mock.on(GetObjectCommand, { Key: 'flows.json' }).resolves({
      Body: stringStream(JSON.stringify({
        flows: [
          { id: 'f1', project_id: 'p1' },
          { id: 'f2', project_id: 'p2' },
        ],
      })),
      ETag: '"e"',
    });
    s3Mock.on(GetObjectCommand, { Key: 'prompts.json' }).resolves({
      Body: stringStream(JSON.stringify({
        prompts: [
          { id: 'gp', project_id: null, text: 'global' },
          { id: 'sp', project_id: 'p1', text: 'scoped' },
        ],
      })),
      ETag: '"e"',
    });
    s3Mock.on(GetObjectCommand, { Key: 'prompt-groups.json' }).resolves({
      Body: stringStream(JSON.stringify({ groups: [{ id: 'pg1', name: 'X' }] })),
      ETag: '"e"',
    });
    // Manifest: starts as 404, then echoes back whatever was last PUT. The
    // migration verifies the manifest after writing it during reshardRemoteData,
    // so the read path needs to return real data once that PUT has happened.
    s3Mock.on(GetObjectCommand, { Key: 'projects-manifest.json' }).callsFake(() => {
      const puts = s3Mock.commandCalls(PutObjectCommand)
        .filter(c => c.args[0].input.Key === 'projects-manifest.json');
      if (puts.length === 0) {
        const err = new Error('NoSuchKey');
        err.name = 'NoSuchKey';
        err.$metadata = { httpStatusCode: 404 };
        throw err;
      }
      const lastPut = puts[puts.length - 1];
      return {
        Body: stringStream(lastPut.args[0].input.Body),
        ETag: '"manifest"',
      };
    });
    // After cleanup deletes flows.json from the remote, a verify spot-check
    // would still try to read projects/p1/flows.json (which was sharded). Make
    // sure that Get works (returns 404 -> fallback). The default 404 covers it.
    // Release path reads the lock back to verify ownership before deleting.
    // Match-any owner -- the migrator owns it because it acquired it.
    s3Mock.on(GetObjectCommand, { Key: '.migrating-v4' }).callsFake(() => {
      const calls = s3Mock.commandCalls(PutObjectCommand).filter(c => c.args[0].input.Key === '.migrating-v4');
      if (calls.length === 0) {
        const err = new Error('NoSuchKey');
        err.name = 'NoSuchKey';
        err.$metadata = { httpStatusCode: 404 };
        throw err;
      }
      // Reflect the most recent PUT body so the owner check passes.
      const lastPut = calls[calls.length - 1];
      return {
        Body: stringStream(lastPut.args[0].input.Body),
        ETag: '"lock-1"',
      };
    });

    const { migrate } = await import('../migrations/v3-to-v4.js');
    const result = await migrate();

    expect(result.ran).toBe(true);
    expect(result.case).toBe(2);

    // storage-config rewritten as v2
    const cfg = readJson('storage-config.json');
    expect(cfg.v).toBe(2);
    expect(cfg.backends).toHaveLength(2); // local + imported
    const imported = cfg.backends.find(b => b.id !== 'local');
    expect(cfg.default_backend_id).toBe(imported.id);
    expect(imported.driver).toBe('s3');
    expect(imported.config.bucket).toBe('pulse-team');
    expect(imported.id).toMatch(/^b-/);

    // S3 received writes for the new layout
    const puts = s3Mock.commandCalls(PutObjectCommand).map(c => c.args[0].input.Key);
    expect(puts).toContain('projects-manifest.json');
    expect(puts).toContain('projects/p1/flows.json');
    expect(puts).toContain('projects/p2/flows.json');
    expect(puts).toContain('projects/p1/prompts.json');

    // No globals key in S3 -- globals went local
    expect(puts.find(k => k.startsWith('globals/'))).toBeUndefined();

    // Local globals written
    const localGlobalPrompts = readJson('globals/prompts.json');
    expect(localGlobalPrompts.prompts).toHaveLength(1);
    expect(localGlobalPrompts.prompts[0].id).toBe('gp');

    const localGlobalGroups = readJson('globals/prompt-groups.json');
    expect(localGlobalGroups.groups).toHaveLength(1);
    expect(localGlobalGroups.groups[0].project_id).toBe(null);

    // Local projects.json got storage_ref pointing at imported backend
    const localProjects = readJson('projects.json');
    expect(localProjects.projects).toHaveLength(2);
    expect(localProjects.projects[0].storage_ref).toBe(imported.id);
    expect(localProjects.projects[1].storage_ref).toBe(imported.id);

    // Lock was released
    const deletes = s3Mock.commandCalls(DeleteObjectCommand);
    expect(deletes.find(c => c.args[0].input.Key === '.migrating-v4')).toBeDefined();

    // Auto-cleanup: assert DeleteObjectCommand was called for each legacy file.
    const deleteKeys = s3Mock.commandCalls(DeleteObjectCommand).map(c => c.args[0].input.Key);
    // Per-project flat (now sharded)
    expect(deleteKeys).toContain('flows.json');
    expect(deleteKeys).toContain('flow-groups.json');
    expect(deleteKeys).toContain('notes.json');
    expect(deleteKeys).toContain('prompts.json');
    expect(deleteKeys).toContain('prompt-groups.json');
    expect(deleteKeys).toContain('task-boards.json');
    expect(deleteKeys).toContain('task-board-groups.json');
    // projects.json flat (replaced by projects-manifest.json)
    expect(deleteKeys).toContain('projects.json');
    // Per-install legacy on remote: this fixture does NOT seed servers.json /
    // sessions.json / intelligence-config.json on the remote (default 404), so
    // there is nothing to copy and nothing local. Cleanup MUST skip them --
    // see the dedicated test "skips deleting per-install files from remote when
    // local copy is missing" below for the safety guarantee.
    expect(deleteKeys).not.toContain('servers.json');
    expect(deleteKeys).not.toContain('sessions.json');
    expect(deleteKeys).not.toContain('intelligence-config.json');
    // Migration lock release also calls DeleteObject; that's expected.
    // Manifest stays untouched.
    expect(deleteKeys).not.toContain('projects-manifest.json');
  });

  it('skips reshard when manifest already exists, just rewrites local config', async () => {
    writeFileSync(join(dataDir, 'storage-config.json'), JSON.stringify({
      driver: 's3', bucket: 'b', region: 'us-east-1', access_key_id: 'k', secret_access_key: 's',
    }));

    s3Mock.on(HeadBucketCommand).resolves({});
    // Defaults first (wider matchers must be declared before specific ones).
    s3Mock.on(GetObjectCommand).rejects({ name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
    s3Mock.on(PutObjectCommand).resolves({ ETag: '"e2"' });
    s3Mock.on(DeleteObjectCommand).resolves({});
    // Specific overrides.
    s3Mock.on(PutObjectCommand, { Key: '.migrating-v4' }).resolves({ ETag: '"l"' });
    // Manifest EXISTS. Use callsFake to return a fresh stream every call --
    // the migration reads it twice (once to detect already-sharded, once to
    // verify the layout for cleanup) and an SDK Body stream can only be
    // consumed once.
    s3Mock.on(GetObjectCommand, { Key: 'projects-manifest.json' }).callsFake(() => ({
      Body: stringStream(JSON.stringify({ v: 1, projects: [{ id: 'p1', name: 'X' }] })),
      ETag: '"e"',
    }));

    // Need to also seed local projects.json so storage_ref can be applied
    writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({
      projects: [{ id: 'p1', name: 'X' }],
      active_project_id: 'p1',
    }));

    const { migrate } = await import('../migrations/v3-to-v4.js');
    const result = await migrate();

    expect(result.ran).toBe(false);
    expect(result.reason).toBe('remote-already-sharded');

    const cfg = readJson('storage-config.json');
    expect(cfg.v).toBe(2);
    const imported = cfg.backends.find(b => b.id !== 'local');
    const localProjects = readJson('projects.json');
    expect(localProjects.projects[0].storage_ref).toBe(imported.id);
  });

  it('throws when migration lock cannot be acquired', async () => {
    writeFileSync(join(dataDir, 'storage-config.json'), JSON.stringify({
      driver: 's3', bucket: 'b', region: 'us-east-1', access_key_id: 'k', secret_access_key: 's',
    }));

    s3Mock.on(HeadBucketCommand).resolves({});
    // Defaults first (wider matchers must be declared before specific ones).
    s3Mock.on(GetObjectCommand).rejects({ name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
    // First PUT (IfNoneMatch) fails 412
    s3Mock.on(PutObjectCommand, { Key: '.migrating-v4' }).rejectsOnce({
      name: 'PreconditionFailed', $metadata: { httpStatusCode: 412 },
    });
    // Read shows fresh lock
    s3Mock.on(GetObjectCommand, { Key: '.migrating-v4' }).resolves({
      Body: stringStream(JSON.stringify({ owner: 'other', heartbeat_at: Date.now() })),
      ETag: '"e1"',
    });

    const { migrate } = await import('../migrations/v3-to-v4.js');
    await expect(migrate()).rejects.toThrow(/Another install is currently migrating/);
  });

  it('copies per-install files from remote to local before cleanup', async () => {
    // Seed v1 config + remote per-install files (full of data) + manifest exists
    // (so we go down the remote-already-sharded short-circuit path).
    writeFileSync(join(dataDir, 'storage-config.json'), JSON.stringify({
      driver: 's3', bucket: 'b', region: 'us-east-1', access_key_id: 'k', secret_access_key: 's',
    }));

    s3Mock.on(HeadBucketCommand).resolves({});
    s3Mock.on(PutObjectCommand, { Key: '.migrating-v4' }).resolves({ ETag: '"l"' });

    // Wider matcher first
    s3Mock.on(GetObjectCommand).callsFake((input) => {
      const key = input.Key;
      if (key === 'projects-manifest.json') {
        return Promise.resolve({
          Body: stringStream(JSON.stringify({ v: 1, projects: [{ id: 'p1', name: 'X' }] })),
          ETag: '"e"',
        });
      }
      // Per-install files exist on remote with real data
      const payloads = {
        'servers.json': { servers: [{ id: 'srv-1', name: 'localhost', apiKey: 'k' }] },
        'sessions.json': { servers: { 'srv-1': [{ id: 'term-1', name: 'shell' }] } },
        'recent-cwds.json': { servers: { 'srv-1': ['/home/user/projects'] } },
        'intelligence-config.json': { providers: { gemini: { api_key: 'g' } } },
        'compose-drafts.json': { drafts: { 'srv-1::term-1': { text: 'echo hi' } } },
        'groups.json': { groups: [{ id: 'g-1', name: 'Team' }] },
        'layouts.json': { default: 'mosaic-config' },
        'view-state.json': { sidebar: 'open' },
      };
      if (payloads[key]) {
        return Promise.resolve({ Body: stringStream(JSON.stringify(payloads[key])), ETag: '"e"' });
      }
      return Promise.reject({ name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
    });
    s3Mock.on(PutObjectCommand).resolves({ ETag: '"e"' });
    s3Mock.on(DeleteObjectCommand).resolves({});

    // Local projects.json must be seeded so the migration can finish.
    writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({
      projects: [{ id: 'p1', name: 'X' }],
      active_project_id: 'p1',
    }));

    const { migrate } = await import('../migrations/v3-to-v4.js');
    const result = await migrate();

    expect(result.ran).toBe(false);
    expect(result.reason).toBe('remote-already-sharded');

    // All 8 per-install files should now exist locally with the remote payloads.
    const local = (rel) => JSON.parse(readFileSync(join(dataDir, rel), 'utf-8'));
    expect(local('servers.json').servers[0].id).toBe('srv-1');
    expect(local('sessions.json').servers['srv-1'][0].id).toBe('term-1');
    expect(local('groups.json').groups[0].id).toBe('g-1');
    expect(local('intelligence-config.json').providers.gemini.api_key).toBe('g');

    // And cleanup should have deleted them from the remote (now that local has copies).
    const deletedKeys = s3Mock.commandCalls(DeleteObjectCommand).map(c => c.args[0].input.Key);
    expect(deletedKeys).toContain('servers.json');
    expect(deletedKeys).toContain('sessions.json');
    expect(deletedKeys).toContain('groups.json');
    expect(deletedKeys).toContain('intelligence-config.json');
  });

  it('skips deleting per-install files from remote when local copy is missing', async () => {
    // Same setup but local folder is "empty" (no per-install files seeded
    // before migration, AND we'll fail the copy step by making remote returns
    // empty payloads -- copy step would write empty data, isLocalFileEmpty
    // would still report empty, cleanup must NOT delete from remote.
    writeFileSync(join(dataDir, 'storage-config.json'), JSON.stringify({
      driver: 's3', bucket: 'b', region: 'us-east-1', access_key_id: 'k', secret_access_key: 's',
    }));
    s3Mock.on(HeadBucketCommand).resolves({});
    s3Mock.on(PutObjectCommand, { Key: '.migrating-v4' }).resolves({ ETag: '"l"' });

    s3Mock.on(GetObjectCommand).callsFake((input) => {
      const key = input.Key;
      if (key === 'projects-manifest.json') {
        return Promise.resolve({
          Body: stringStream(JSON.stringify({ v: 1, projects: [] })),
          ETag: '"e"',
        });
      }
      // Per-install: remote has populated servers.json, but ALL OTHERS are empty/missing.
      if (key === 'servers.json') {
        return Promise.resolve({
          Body: stringStream(JSON.stringify({ servers: [{ id: 'srv-x' }] })),
          ETag: '"e"',
        });
      }
      // Empty payload for sessions/groups/etc -- copy will write {empty}, cleanup
      // should preserve the remote because local stays empty.
      if (key === 'sessions.json') {
        return Promise.resolve({
          Body: stringStream(JSON.stringify({ servers: {} })),
          ETag: '"e"',
        });
      }
      return Promise.reject({ name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
    });
    s3Mock.on(PutObjectCommand).resolves({ ETag: '"e"' });
    s3Mock.on(DeleteObjectCommand).resolves({});

    writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [], active_project_id: null }));

    const { migrate } = await import('../migrations/v3-to-v4.js');
    await migrate();

    // servers.json had data -- copied + remote deleted.
    const deletedKeys = s3Mock.commandCalls(DeleteObjectCommand).map(c => c.args[0].input.Key);
    expect(deletedKeys).toContain('servers.json');
    // sessions.json was empty payload -- local stays empty, remote delete skipped.
    expect(deletedKeys).not.toContain('sessions.json');
  });
});
