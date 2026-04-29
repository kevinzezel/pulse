import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('GET /api/flow-groups', () => {
  let route;
  let projectStorage;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('@/lib/projectStorage', () => ({
      readProjectFile: vi.fn(async () => ({
        groups: [{ id: 'fgid-1', name: 'A', project_id: 'other-project' }],
      })),
      writeProjectFile: vi.fn(),
      withProjectLock: vi.fn(async (pid, file, fn) => fn()),
    }));
    vi.doMock('@/lib/auth', () => ({ withAuth: (fn) => fn }));
    projectStorage = await import('@/lib/projectStorage');
    route = await import('@/app/api/flow-groups/route');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stamps returned groups with the requested project', async () => {
    const req = new Request('http://localhost/api/flow-groups?project_id=p1');
    const res = await route.GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.groups).toEqual([
      expect.objectContaining({ id: 'fgid-1', project_id: 'p1' }),
    ]);
    expect(projectStorage.readProjectFile).toHaveBeenCalledWith('p1', 'flow-groups.json', expect.anything());
  });
});

describe('PUT /api/flow-groups', () => {
  let route;
  let projectStorage;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('@/lib/projectStorage', () => ({
      readProjectFile: vi.fn(),
      writeProjectFile: vi.fn(),
      withProjectLock: vi.fn(async (pid, file, fn) => fn()),
    }));
    vi.doMock('@/lib/auth', () => ({ withAuth: (fn) => fn }));
    projectStorage = await import('@/lib/projectStorage');
    route = await import('@/app/api/flow-groups/route');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('force-stamps replaced groups with the requested project', async () => {
    const req = new Request('http://localhost/api/flow-groups?project_id=p1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        groups: [{ id: 'fgid-1', name: 'A', project_id: 'other-project' }],
      }),
    });
    const res = await route.PUT(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.groups[0].project_id).toBe('p1');
    expect(projectStorage.writeProjectFile).toHaveBeenCalledWith('p1', 'flow-groups.json', {
      groups: [expect.objectContaining({ id: 'fgid-1', project_id: 'p1' })],
    });
  });
});
