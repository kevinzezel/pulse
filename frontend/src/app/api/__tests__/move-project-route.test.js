import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('POST /api/projects/[id]/move', () => {
  let route;
  let projectMove;
  let storage;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('@/lib/storage', () => ({
      getConfig: vi.fn(async () => ({
        v: 2,
        backends: [
          { id: 'local', name: 'Local', driver: 'file', config: {} },
          { id: 'b-1', name: 'Dipol', driver: 's3', config: {} },
        ],
        default_backend_id: 'local',
      })),
    }));
    vi.doMock('@/lib/projectIndex', () => ({
      listAllProjects: vi.fn(async () => ([
        { id: 'p1', name: 'P1', backend_id: 'local', created_at: '2024-01-01T00:00:00Z' },
      ])),
      findProjectBackend: vi.fn(async (id) => (id === 'p1' ? 'local' : null)),
    }));
    vi.doMock('@/lib/projectMove', () => ({
      moveProjectShards: vi.fn(async () => ({ copied: 3 })),
    }));
    vi.doMock('@/lib/auth', () => ({ withAuth: (fn) => fn }));
    storage = await import('@/lib/storage');
    projectMove = await import('@/lib/projectMove');
    route = await import('@/app/api/projects/[id]/move/route');
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it('400 when target_backend_id missing', async () => {
    const req = new Request('http://localhost/api/projects/p1/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const res = await route.POST(req, { params: Promise.resolve({ id: 'p1' }) });
    expect(res.status).toBe(400);
  });

  it('404 when project not found locally', async () => {
    const req = new Request('http://localhost/api/projects/p-missing/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_backend_id: 'b-1' }),
    });
    const res = await route.POST(req, { params: Promise.resolve({ id: 'p-missing' }) });
    expect(res.status).toBe(404);
  });

  it('400 when target backend equals source', async () => {
    const req = new Request('http://localhost/api/projects/p1/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_backend_id: 'local' }),
    });
    const res = await route.POST(req, { params: Promise.resolve({ id: 'p1' }) });
    expect(res.status).toBe(400);
  });

  it('moves shards then updates local projects.json with new storage_ref', async () => {
    const req = new Request('http://localhost/api/projects/p1/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_backend_id: 'b-1' }),
    });
    const res = await route.POST(req, { params: Promise.resolve({ id: 'p1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe('p1');
    expect(body.storage_ref).toBe('b-1');
    expect(projectMove.moveProjectShards).toHaveBeenCalledWith('p1', 'local', 'b-1', expect.objectContaining({ name: 'P1' }));
  });
});
