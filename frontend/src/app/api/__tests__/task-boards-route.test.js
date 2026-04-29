import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('GET /api/task-boards', () => {
  let route;
  let projectStorage;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('@/lib/projectStorage', () => ({
      readProjectFile: vi.fn(),
      writeProjectFile: vi.fn(),
      withProjectLock: vi.fn(async (pid, file, fn) => fn()),
      validateGroupBelongsToProject: vi.fn(async () => null),
    }));
    vi.doMock('@/lib/auth', () => ({ withAuth: (fn) => fn }));
    projectStorage = await import('@/lib/projectStorage');
    route = await import('@/app/api/task-boards/route');
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it('400 without project_id', async () => {
    const req = new Request('http://localhost/api/task-boards');
    const res = await route.GET(req);
    expect(res.status).toBe(400);
  });

  it('returns boards for project', async () => {
    projectStorage.readProjectFile.mockResolvedValue({
      boards: [{ id: 'tboard-1', project_id: 'p1', name: 'A' }],
    });
    const req = new Request('http://localhost/api/task-boards?project_id=p1');
    const res = await route.GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.boards).toHaveLength(1);
    expect(projectStorage.readProjectFile).toHaveBeenCalledWith('p1', 'task-boards.json', expect.anything());
  });
});

describe('POST /api/task-boards', () => {
  let route;
  let projectStorage;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('@/lib/projectStorage', () => ({
      readProjectFile: vi.fn(async () => ({ boards: [] })),
      writeProjectFile: vi.fn(),
      withProjectLock: vi.fn(async (pid, file, fn) => fn()),
      validateGroupBelongsToProject: vi.fn(async () => null),
    }));
    vi.doMock('@/lib/auth', () => ({ withAuth: (fn) => fn }));
    projectStorage = await import('@/lib/projectStorage');
    route = await import('@/app/api/task-boards/route');
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it('creates board atomically with default columns', async () => {
    const req = new Request('http://localhost/api/task-boards?project_id=p1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Sprint' }),
    });
    const res = await route.POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toMatch(/^tboard-/);
    expect(body.project_id).toBe('p1');
    expect(body.name).toBe('Sprint');
    expect(Array.isArray(body.columns)).toBe(true);
    expect(projectStorage.withProjectLock).toHaveBeenCalledWith('p1', 'task-boards.json', expect.any(Function));
  });

  it('400 without project_id on POST', async () => {
    const req = new Request('http://localhost/api/task-boards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'X' }),
    });
    const res = await route.POST(req);
    expect(res.status).toBe(400);
  });
});
