import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('GET /api/storage/backends/[id]/manifest', () => {
  let route;
  let storage;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('@/lib/storage', () => ({
      readStoreFromBackend: vi.fn(async () => ({ v: 1, projects: [{ id: 'p1', name: 'P1' }] })),
    }));
    vi.doMock('@/lib/auth', () => ({ withAuth: (fn) => fn }));
    storage = await import('@/lib/storage');
    route = await import('@/app/api/storage/backends/[id]/manifest/route');
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it('reads the canonical data/projects-manifest.json', async () => {
    const req = new Request('http://localhost/api/storage/backends/local/manifest');
    const res = await route.GET(req, { params: Promise.resolve({ id: 'local' }) });
    expect(res.status).toBe(200);
    expect(storage.readStoreFromBackend).toHaveBeenCalledWith(
      'local',
      'data/projects-manifest.json',
      expect.anything(),
    );
    const body = await res.json();
    expect(body.projects).toHaveLength(1);
    expect(body.projects[0].id).toBe('p1');
  });

  it('returns 404 when backend is unknown', async () => {
    storage.readStoreFromBackend.mockRejectedValueOnce(new Error('unknown backend: ghost'));
    const req = new Request('http://localhost/api/storage/backends/ghost/manifest');
    const res = await route.GET(req, { params: Promise.resolve({ id: 'ghost' }) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.detail_key).toBe('errors.backend_unknown');
  });
});
