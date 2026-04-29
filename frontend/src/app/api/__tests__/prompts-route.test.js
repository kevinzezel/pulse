import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('GET /api/prompts', () => {
  let route;
  let projectStorage;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('@/lib/projectStorage', () => ({
      readProjectFile: vi.fn(async () => ({ prompts: [{ id: 'pp1', project_id: 'p1' }] })),
      readGlobalFile: vi.fn(async () => ({ prompts: [{ id: 'gp1', project_id: null }] })),
      writeProjectFile: vi.fn(),
      writeGlobalFile: vi.fn(),
      withProjectLock: vi.fn(async (pid, file, fn) => fn()),
      withGlobalLock: vi.fn(async (file, fn) => fn()),
    }));
    vi.doMock('@/lib/auth', () => ({ withAuth: (fn) => fn }));
    projectStorage = await import('@/lib/projectStorage');
    route = await import('@/app/api/prompts/route');
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it('400 without project_id and without scope', async () => {
    const req = new Request('http://localhost/api/prompts');
    const res = await route.GET(req);
    expect(res.status).toBe(400);
  });

  it('returns project-scoped prompts when ?project_id=X', async () => {
    const req = new Request('http://localhost/api/prompts?project_id=p1');
    const res = await route.GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.prompts[0].id).toBe('pp1');
    expect(projectStorage.readProjectFile).toHaveBeenCalledWith('p1', 'prompts.json', expect.anything());
    expect(projectStorage.readGlobalFile).not.toHaveBeenCalled();
  });

  it('returns globals when ?scope=global', async () => {
    const req = new Request('http://localhost/api/prompts?scope=global');
    const res = await route.GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.prompts[0].id).toBe('gp1');
    expect(projectStorage.readGlobalFile).toHaveBeenCalled();
    expect(projectStorage.readProjectFile).not.toHaveBeenCalled();
  });

  it('rejects ?project_id=null literal string', async () => {
    const req = new Request('http://localhost/api/prompts?project_id=null');
    const res = await route.GET(req);
    expect(res.status).toBe(400);
  });
});

describe('POST /api/prompts', () => {
  let route;
  let projectStorage;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('@/lib/projectStorage', () => ({
      readProjectFile: vi.fn(async () => ({ prompts: [] })),
      readGlobalFile: vi.fn(async () => ({ prompts: [] })),
      writeProjectFile: vi.fn(),
      writeGlobalFile: vi.fn(),
      withProjectLock: vi.fn(async (pid, file, fn) => fn()),
      withGlobalLock: vi.fn(async (file, fn) => fn()),
    }));
    vi.doMock('@/lib/auth', () => ({ withAuth: (fn) => fn }));
    projectStorage = await import('@/lib/projectStorage');
    route = await import('@/app/api/prompts/route');
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it('creates project-scoped prompt with ?project_id=X', async () => {
    const req = new Request('http://localhost/api/prompts?project_id=p1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'X', body: 'Y' }),
    });
    const res = await route.POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toMatch(/^pid-/);
    expect(body.project_id).toBe('p1');
    expect(projectStorage.withProjectLock).toHaveBeenCalled();
  });

  it('creates global prompt with ?scope=global', async () => {
    const req = new Request('http://localhost/api/prompts?scope=global', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'X', body: 'Y' }),
    });
    const res = await route.POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.project_id).toBe(null);
    expect(projectStorage.withGlobalLock).toHaveBeenCalled();
  });
});
