import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('POST /api/storage/share-token/[id]', () => {
  let route;
  let storage;
  let backendToken;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('@/lib/storage', () => ({
      getConfig: vi.fn(async () => ({
        v: 2,
        backends: [
          { id: 'local', name: 'Local', driver: 'file', config: {} },
          { id: 'b-1', name: 'Dipol', driver: 's3', config: { bucket: 'b', region: 'us-east-1', access_key_id: 'k', secret_access_key: 's' } },
        ],
        default_backend_id: 'b-1',
      })),
    }));
    vi.doMock('@/lib/auth', () => ({ withAuth: (fn) => fn }));
    storage = await import('@/lib/storage');
    backendToken = await import('@/lib/backendToken');
    route = await import('@/app/api/storage/share-token/[id]/route');
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it('returns a token that decodes back to the backend payload', async () => {
    const req = new Request('http://localhost/api/storage/share-token/b-1', { method: 'POST' });
    const res = await route.POST(req, { params: Promise.resolve({ id: 'b-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toMatch(/^pulsebackend:\/\/v1\//);
    const decoded = backendToken.decodeBackendToken(body.token);
    expect(decoded.backend.name).toBe('Dipol');
    expect(decoded.backend.driver).toBe('s3');
    expect(decoded.backend.config.bucket).toBe('b');
    expect(decoded.backend.config.access_key_id).toBe('k'); // FULL secret in token
  });

  it('rejects sharing the local backend', async () => {
    const req = new Request('http://localhost/api/storage/share-token/local', { method: 'POST' });
    const res = await route.POST(req, { params: Promise.resolve({ id: 'local' }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.detail_key).toBe('errors.backend_local_not_shareable');
  });

  it('404 when backend id is unknown', async () => {
    const req = new Request('http://localhost/api/storage/share-token/b-missing', { method: 'POST' });
    const res = await route.POST(req, { params: Promise.resolve({ id: 'b-missing' }) });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/storage/import-token', () => {
  let route;
  let storage;
  let backendToken;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('@/lib/storage', () => ({
      addBackend: vi.fn(async () => 'b-new'),
      readStoreFromBackend: vi.fn(async () => ({
        v: 1,
        projects: [
          { id: 'p1', name: 'AdsScanner' },
          { id: 'p2', name: 'Dipol' },
        ],
      })),
    }));
    vi.doMock('@/lib/s3Store', () => ({ pingS3: vi.fn(async () => undefined) }));
    vi.doMock('@/lib/mongoStore', () => ({ pingMongo: vi.fn(async () => undefined) }));
    vi.doMock('@/lib/auth', () => ({ withAuth: (fn) => fn }));
    storage = await import('@/lib/storage');
    backendToken = await import('@/lib/backendToken');
    route = await import('@/app/api/storage/import-token/route');
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it('decodes token, adds backend, reads manifest, returns preview', async () => {
    const token = backendToken.encodeBackendToken({
      name: 'Dipol',
      driver: 's3',
      config: { bucket: 'b', region: 'us-east-1', access_key_id: 'k', secret_access_key: 's' },
    });
    const req = new Request('http://localhost/api/storage/import-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const res = await route.POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.backend_id).toBe('b-new');
    expect(body.projects).toHaveLength(2);
    expect(body.projects[0].name).toBe('AdsScanner');
    expect(storage.addBackend).toHaveBeenCalled();
    expect(storage.readStoreFromBackend).toHaveBeenCalledWith('b-new', 'data/projects-manifest.json', expect.anything());
  });

  it('400 on malformed token', async () => {
    const req = new Request('http://localhost/api/storage/import-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'pulsebackend://v1/garbage' }),
    });
    const res = await route.POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.detail_key).toBe('errors.invalid_token');
    expect(storage.addBackend).not.toHaveBeenCalled();
  });
});
