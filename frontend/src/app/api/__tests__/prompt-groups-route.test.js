import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('GET /api/prompt-groups', () => {
  let route;
  let projectStorage;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('@/lib/projectStorage', () => ({
      readProjectFile: vi.fn(async () => ({
        groups: [{ id: 'pgid-1', name: 'A', project_id: 'stale-project' }],
      })),
      writeProjectFile: vi.fn(),
      withProjectLock: vi.fn(async (pid, file, fn) => fn()),
    }));
    vi.doMock('@/lib/auth', () => ({ withAuth: (fn) => fn }));
    projectStorage = await import('@/lib/projectStorage');
    route = await import('@/app/api/prompt-groups/route');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 400 without project_id', async () => {
    const req = new Request('http://localhost/api/prompt-groups');
    const res = await route.GET(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 for scope=global', async () => {
    const req = new Request('http://localhost/api/prompt-groups?scope=global');
    const res = await route.GET(req);
    expect(res.status).toBe(400);
    expect(projectStorage.readProjectFile).not.toHaveBeenCalled();
  });

  it('returns project-scoped groups stamped with the requested project', async () => {
    const req = new Request('http://localhost/api/prompt-groups?project_id=p1');
    const res = await route.GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.groups).toEqual([
      expect.objectContaining({ id: 'pgid-1', project_id: 'p1' }),
    ]);
    expect(projectStorage.readProjectFile).toHaveBeenCalledWith('p1', 'prompt-groups.json', expect.anything());
  });
});

describe('POST /api/prompt-groups', () => {
  let route;
  let projectStorage;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('@/lib/projectStorage', () => ({
      readProjectFile: vi.fn(async () => ({ groups: [] })),
      writeProjectFile: vi.fn(),
      withProjectLock: vi.fn(async (pid, file, fn) => fn()),
    }));
    vi.doMock('@/lib/auth', () => ({ withAuth: (fn) => fn }));
    projectStorage = await import('@/lib/projectStorage');
    route = await import('@/app/api/prompt-groups/route');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a group inside the requested project', async () => {
    const req = new Request('http://localhost/api/prompt-groups?project_id=p1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Group A' }),
    });
    const res = await route.POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toMatch(/^pgid-/);
    expect(body.project_id).toBe('p1');
    expect(projectStorage.writeProjectFile).toHaveBeenCalledWith('p1', 'prompt-groups.json', {
      groups: [expect.objectContaining({ name: 'Group A', project_id: 'p1' })],
    });
  });
});
