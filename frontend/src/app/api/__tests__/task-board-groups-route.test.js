import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('GET /api/task-board-groups', () => {
  let route;
  let projectStorage;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('@/lib/projectStorage', () => ({
      readProjectFile: vi.fn(async () => ({
        groups: [
          { id: 'tbg-legacy', name: 'Legacy' },
          { id: 'tbg-other', name: 'Other', project_id: 'other-project' },
          { id: 'tbg-1', name: 'A', project_id: 'p1' },
        ],
      })),
      writeProjectFile: vi.fn(),
      withProjectLock: vi.fn(async (pid, file, fn) => fn()),
    }));
    vi.doMock('@/lib/auth', () => ({ withAuth: (fn) => fn }));
    projectStorage = await import('@/lib/projectStorage');
    route = await import('@/app/api/task-board-groups/route');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns only groups that belong to the requested project', async () => {
    const req = new Request('http://localhost/api/task-board-groups?project_id=p1');
    const res = await route.GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.groups.map((g) => g.id)).toEqual(['tbg-legacy', 'tbg-1']);
    expect(body.groups.every((g) => g.project_id === 'p1')).toBe(true);
    expect(projectStorage.readProjectFile).toHaveBeenCalledWith('p1', 'task-board-groups.json', expect.anything());
  });
});

describe('PUT /api/task-board-groups', () => {
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
    route = await import('@/app/api/task-board-groups/route');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('drops replaced groups from other projects and stamps legacy groups', async () => {
    const req = new Request('http://localhost/api/task-board-groups?project_id=p1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        groups: [
          { id: 'tbg-legacy', name: 'Legacy' },
          { id: 'tbg-other', name: 'Other', project_id: 'other-project' },
          { id: 'tbg-1', name: 'A', project_id: 'p1' },
        ],
      }),
    });
    const res = await route.PUT(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.groups.map((g) => g.id)).toEqual(['tbg-legacy', 'tbg-1']);
    expect(body.groups.every((g) => g.project_id === 'p1')).toBe(true);
    expect(projectStorage.writeProjectFile).toHaveBeenCalledWith('p1', 'task-board-groups.json', {
      groups: [
        expect.objectContaining({ id: 'tbg-legacy', project_id: 'p1' }),
        expect.objectContaining({ id: 'tbg-1', project_id: 'p1' }),
      ],
    });
  });
});
