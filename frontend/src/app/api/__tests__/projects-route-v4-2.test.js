import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('GET /api/projects (v4.2)', () => {
  let route;
  let projectIndex;
  let projectPrefs;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('@/lib/projectIndex', () => ({
      listAllProjects: vi.fn(async () => [
        { id: 'p1', name: 'Local Proj', backend_id: 'local', created_at: 't1', updated_at: 't1' },
        { id: 'p2', name: 'Remote Proj', backend_id: 'b-1', created_at: 't2', updated_at: 't2' },
      ]),
      addProjectToManifest: vi.fn(),
    }));
    vi.doMock('@/lib/projectPrefs', () => ({
      readProjectPrefs: vi.fn(async () => ({ active_project_id: 'p2', default_project_id: 'p1' })),
      setActiveProjectPref: vi.fn(),
    }));
    vi.doMock('@/lib/storage', () => ({
      getConfig: vi.fn(async () => ({
        v: 3,
        backends: [
          { id: 'local', name: 'Local', driver: 'file', config: {} },
          { id: 'b-1', name: 'Remote', driver: 's3', config: {} },
        ],
        default_backend_id: 'local',
      })),
    }));
    vi.doMock('@/lib/auth', () => ({ withAuth: (fn) => fn }));

    projectIndex = await import('@/lib/projectIndex');
    projectPrefs = await import('@/lib/projectPrefs');
    route = await import('@/app/api/projects/route');
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it('aggregates manifests, decorates with storage_ref, marks is_default from prefs', async () => {
    const res = await route.GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.projects).toHaveLength(2);
    const byId = Object.fromEntries(body.projects.map((p) => [p.id, p]));
    expect(byId.p1.storage_ref).toBe('local');
    expect(byId.p1.is_default).toBe(true);
    expect(byId.p2.storage_ref).toBe('b-1');
    expect(byId.p2.is_default).toBe(false);
    expect(body.active_project_id).toBe('p2');
  });

  it('falls back active_project_id to default when prefs.active is unknown', async () => {
    projectPrefs.readProjectPrefs.mockResolvedValueOnce({
      active_project_id: 'gone',
      default_project_id: 'p1',
    });
    const res = await route.GET();
    const body = await res.json();
    expect(body.active_project_id).toBe('p1');
  });

  it('falls back to first project when neither active nor default is known', async () => {
    projectPrefs.readProjectPrefs.mockResolvedValueOnce({
      active_project_id: null,
      default_project_id: null,
    });
    const res = await route.GET();
    const body = await res.json();
    expect(body.active_project_id).toBe('p1');
  });
});

describe('POST /api/projects (v4.2)', () => {
  let route;
  let projectIndex;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('@/lib/projectIndex', () => ({
      listAllProjects: vi.fn(async () => []),
      addProjectToManifest: vi.fn(),
    }));
    vi.doMock('@/lib/projectPrefs', () => ({
      readProjectPrefs: vi.fn(async () => ({ active_project_id: null, default_project_id: null })),
      setActiveProjectPref: vi.fn(),
    }));
    vi.doMock('@/lib/storage', () => ({
      getConfig: vi.fn(async () => ({
        v: 3,
        backends: [
          { id: 'local', name: 'Local', driver: 'file', config: {} },
          { id: 'b-1', name: 'Remote', driver: 's3', config: {} },
        ],
        default_backend_id: 'local',
      })),
    }));
    vi.doMock('@/lib/auth', () => ({ withAuth: (fn) => fn }));

    projectIndex = await import('@/lib/projectIndex');
    route = await import('@/app/api/projects/route');
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it('creates project on target_backend_id and returns 201 with backend ref', async () => {
    const req = new Request('http://localhost/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Proj', target_backend_id: 'b-1' }),
    });
    const res = await route.POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toMatch(/^proj-/);
    expect(body.name).toBe('New Proj');
    expect(body.storage_ref).toBe('b-1');
    expect(body.is_default).toBe(false);
    expect(projectIndex.addProjectToManifest).toHaveBeenCalledWith('b-1', expect.objectContaining({
      id: body.id, name: 'New Proj',
    }));
  });

  it('defaults target_backend_id to "local" when missing', async () => {
    const req = new Request('http://localhost/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Proj' }),
    });
    const res = await route.POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.storage_ref).toBe('local');
    expect(projectIndex.addProjectToManifest).toHaveBeenCalledWith('local', expect.any(Object));
  });

  it('400 when name is empty', async () => {
    const req = new Request('http://localhost/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '   ' }),
    });
    const res = await route.POST(req);
    expect(res.status).toBe(400);
  });

  it('404 when target_backend_id is unknown', async () => {
    const req = new Request('http://localhost/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'X', target_backend_id: 'b-vanished' }),
    });
    const res = await route.POST(req);
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/projects (v4.2 active pref)', () => {
  let route;
  let projectPrefs;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('@/lib/projectIndex', () => ({
      listAllProjects: vi.fn(async () => []),
      addProjectToManifest: vi.fn(),
    }));
    vi.doMock('@/lib/projectPrefs', () => ({
      readProjectPrefs: vi.fn(async () => ({ active_project_id: null, default_project_id: null })),
      setActiveProjectPref: vi.fn(),
    }));
    vi.doMock('@/lib/storage', () => ({
      getConfig: vi.fn(async () => ({
        v: 3,
        backends: [{ id: 'local', name: 'Local', driver: 'file', config: {} }],
        default_backend_id: 'local',
      })),
    }));
    vi.doMock('@/lib/auth', () => ({ withAuth: (fn) => fn }));

    projectPrefs = await import('@/lib/projectPrefs');
    route = await import('@/app/api/projects/route');
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it('updates active_project_id pref', async () => {
    const req = new Request('http://localhost/api/projects', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active_project_id: 'p1' }),
    });
    const res = await route.PUT(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.active_project_id).toBe('p1');
    expect(projectPrefs.setActiveProjectPref).toHaveBeenCalledWith('p1');
  });

  it('400 when active_project_id is missing', async () => {
    const req = new Request('http://localhost/api/projects', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const res = await route.PUT(req);
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/projects/[id] (v4.2)', () => {
  let route;
  let projectIndex;
  let projectPrefs;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('@/lib/projectIndex', () => ({
      listAllProjects: vi.fn(async () => []),
      addProjectToManifest: vi.fn(),
      removeProjectFromManifest: vi.fn(),
      findProjectBackend: vi.fn(async (id) => (id === 'p1' ? 'local' : null)),
    }));
    vi.doMock('@/lib/projectPrefs', () => ({
      setDefaultProjectPref: vi.fn(),
    }));
    vi.doMock('@/lib/storage', () => ({
      getDriverFor: vi.fn(async () => ({
        deleteFile: vi.fn(async () => true),
      })),
    }));
    vi.doMock('@/lib/auth', () => ({ withAuth: (fn) => fn }));

    projectIndex = await import('@/lib/projectIndex');
    projectPrefs = await import('@/lib/projectPrefs');
    route = await import('@/app/api/projects/[id]/route');
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it('PATCH set_default updates per-install pref', async () => {
    const req = new Request('http://localhost/api/projects/p1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ set_default: true }),
    });
    const res = await route.PATCH(req, { params: Promise.resolve({ id: 'p1' }) });
    expect(res.status).toBe(200);
    expect(projectPrefs.setDefaultProjectPref).toHaveBeenCalledWith('p1');
  });

  it('PATCH name updates the owning backend manifest', async () => {
    const req = new Request('http://localhost/api/projects/p1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed' }),
    });
    const res = await route.PATCH(req, { params: Promise.resolve({ id: 'p1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('Renamed');
    expect(body.storage_ref).toBe('local');
    expect(projectIndex.addProjectToManifest).toHaveBeenCalledWith('local', { id: 'p1', name: 'Renamed' });
  });

  it('PATCH name 404 when project not found in any manifest', async () => {
    const req = new Request('http://localhost/api/projects/missing', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'X' }),
    });
    const res = await route.PATCH(req, { params: Promise.resolve({ id: 'missing' }) });
    expect(res.status).toBe(404);
  });

  it('PATCH 400 when neither set_default nor name is provided', async () => {
    const req = new Request('http://localhost/api/projects/p1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wat: true }),
    });
    const res = await route.PATCH(req, { params: Promise.resolve({ id: 'p1' }) });
    expect(res.status).toBe(400);
  });

  it('PATCH 400 when name is empty', async () => {
    const req = new Request('http://localhost/api/projects/p1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '   ' }),
    });
    const res = await route.PATCH(req, { params: Promise.resolve({ id: 'p1' }) });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/projects/[id] (v4.2)', () => {
  let route;
  let projectIndex;
  let storage;
  let deleteFileMock;

  beforeEach(async () => {
    vi.resetModules();
    deleteFileMock = vi.fn(async () => true);
    vi.doMock('@/lib/projectIndex', () => ({
      listAllProjects: vi.fn(async () => []),
      addProjectToManifest: vi.fn(),
      removeProjectFromManifest: vi.fn(),
      findProjectBackend: vi.fn(async (id) => (id === 'p1' ? 'local' : null)),
    }));
    vi.doMock('@/lib/projectPrefs', () => ({
      setDefaultProjectPref: vi.fn(),
    }));
    vi.doMock('@/lib/storage', () => ({
      getDriverFor: vi.fn(async () => ({
        deleteFile: deleteFileMock,
      })),
    }));
    vi.doMock('@/lib/auth', () => ({ withAuth: (fn) => fn }));

    projectIndex = await import('@/lib/projectIndex');
    storage = await import('@/lib/storage');
    route = await import('@/app/api/projects/[id]/route');
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it('removes the manifest entry and best-effort deletes shards', async () => {
    const req = new Request('http://localhost/api/projects/p1', { method: 'DELETE' });
    const res = await route.DELETE(req, { params: Promise.resolve({ id: 'p1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.removed).toBe(true);
    expect(projectIndex.removeProjectFromManifest).toHaveBeenCalledWith('local', 'p1');
    // 7 shard files attempted.
    expect(deleteFileMock).toHaveBeenCalled();
    const calls = deleteFileMock.mock.calls.map((c) => c[0]);
    expect(calls).toContain('data/projects/p1/flows.json');
    expect(calls).toContain('data/projects/p1/notes.json');
    expect(calls).toContain('data/projects/p1/prompts.json');
  });

  it('404 when project not found', async () => {
    const req = new Request('http://localhost/api/projects/missing', { method: 'DELETE' });
    const res = await route.DELETE(req, { params: Promise.resolve({ id: 'missing' }) });
    expect(res.status).toBe(404);
  });

  it('still succeeds when shard deletion errors', async () => {
    deleteFileMock.mockRejectedValue(new Error('boom'));
    const req = new Request('http://localhost/api/projects/p1', { method: 'DELETE' });
    const res = await route.DELETE(req, { params: Promise.resolve({ id: 'p1' }) });
    expect(res.status).toBe(200);
    expect(projectIndex.removeProjectFromManifest).toHaveBeenCalled();
  });
});
