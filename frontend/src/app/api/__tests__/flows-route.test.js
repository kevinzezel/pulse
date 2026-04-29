import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('GET /api/flows', () => {
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
    vi.doMock('@/lib/auth', () => ({
      withAuth: (fn) => fn,
    }));
    projectStorage = await import('@/lib/projectStorage');
    route = await import('@/app/api/flows/route');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 400 when project_id is missing', async () => {
    const req = new Request('http://localhost/api/flows');
    const res = await route.GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.detail_key).toBe('errors.invalid_body');
  });

  it('returns flows for the given project', async () => {
    projectStorage.readProjectFile.mockResolvedValue({
      flows: [{ id: 'f1', project_id: 'p1', name: 'A' }],
    });
    const req = new Request('http://localhost/api/flows?project_id=p1');
    const res = await route.GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.flows).toHaveLength(1);
    expect(projectStorage.readProjectFile).toHaveBeenCalledWith('p1', 'flows.json', expect.anything());
  });
});

describe('POST /api/flows', () => {
  let route;
  let projectStorage;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('@/lib/projectStorage', () => ({
      resolveProjectStorage: vi.fn(),
      readProjectFile: vi.fn(async () => ({ flows: [] })),
      writeProjectFile: vi.fn(),
      withProjectLock: vi.fn(async (pid, file, fn) => fn()),
    }));
    vi.doMock('@/lib/auth', () => ({ withAuth: (fn) => fn }));
    projectStorage = await import('@/lib/projectStorage');
    route = await import('@/app/api/flows/route');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a flow atomically inside withProjectLock', async () => {
    const req = new Request('http://localhost/api/flows?project_id=p1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Flow', scene: { elements: [] } }),
    });
    const res = await route.POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toMatch(/^flow-/);
    expect(body.name).toBe('New Flow');
    expect(body.project_id).toBe('p1');
    expect(projectStorage.withProjectLock).toHaveBeenCalledWith('p1', 'flows.json', expect.any(Function));
    expect(projectStorage.writeProjectFile).toHaveBeenCalledWith('p1', 'flows.json', expect.objectContaining({
      flows: expect.arrayContaining([expect.objectContaining({ name: 'New Flow' })]),
    }));
  });

  it('returns 400 when project_id is missing on POST', async () => {
    const req = new Request('http://localhost/api/flows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'X' }),
    });
    const res = await route.POST(req);
    expect(res.status).toBe(400);
  });
});
