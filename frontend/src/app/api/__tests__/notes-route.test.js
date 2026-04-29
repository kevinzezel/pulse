import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('GET /api/notes', () => {
  let route;
  let projectStorage;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('@/lib/projectStorage', () => ({
      resolveProjectStorage: vi.fn(),
      readProjectFile: vi.fn(),
      writeProjectFile: vi.fn(),
      withProjectLock: vi.fn(async (pid, file, fn) => fn()),
    }));
    vi.doMock('@/lib/auth', () => ({ withAuth: (fn) => fn }));
    projectStorage = await import('@/lib/projectStorage');
    route = await import('@/app/api/notes/route');
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it('400 without project_id', async () => {
    const req = new Request('http://localhost/api/notes');
    const res = await route.GET(req);
    expect(res.status).toBe(400);
  });

  it('returns notes for project', async () => {
    projectStorage.readProjectFile.mockResolvedValue({
      notes: [{ id: 'n1', project_id: 'p1' }],
    });
    const req = new Request('http://localhost/api/notes?project_id=p1');
    const res = await route.GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.notes).toHaveLength(1);
    expect(projectStorage.readProjectFile).toHaveBeenCalledWith('p1', 'notes.json', expect.anything());
  });
});

describe('POST /api/notes', () => {
  let route;
  let projectStorage;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('@/lib/projectStorage', () => ({
      readProjectFile: vi.fn(async () => ({ notes: [] })),
      writeProjectFile: vi.fn(),
      withProjectLock: vi.fn(async (pid, file, fn) => fn()),
    }));
    vi.doMock('@/lib/auth', () => ({ withAuth: (fn) => fn }));
    projectStorage = await import('@/lib/projectStorage');
    route = await import('@/app/api/notes/route');
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it('creates note atomically with default fields', async () => {
    const req = new Request('http://localhost/api/notes?project_id=p1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'A', content: 'B', color: 'yellow' }),
    });
    const res = await route.POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toMatch(/^note-/);
    expect(body.project_id).toBe('p1');
    expect(body.title).toBe('A');
    expect(body.color).toBe('yellow');
    expect(projectStorage.withProjectLock).toHaveBeenCalledWith('p1', 'notes.json', expect.any(Function));
  });

  it('400 without project_id on POST', async () => {
    const req = new Request('http://localhost/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'X' }),
    });
    const res = await route.POST(req);
    expect(res.status).toBe(400);
  });
});
