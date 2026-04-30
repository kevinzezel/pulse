import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('GET /api/storage/backends', () => {
  let route;
  let storage;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('@/lib/storage', () => ({
      getConfig: vi.fn(async () => ({
        v: 2,
        backends: [
          { id: 'local', name: 'Local', driver: 'file', config: {} },
          { id: 'b-1', name: 'Dipol', driver: 's3', config: { bucket: 'b', access_key_id: 'k', secret_access_key: 's', region: 'us-east-1' } },
        ],
        default_backend_id: 'b-1',
      })),
      addBackend: vi.fn(),
      removeBackend: vi.fn(),
      setDefaultBackend: vi.fn(),
    }));
    vi.doMock('@/lib/auth', () => ({ withAuth: (fn) => fn }));
    storage = await import('@/lib/storage');
    route = await import('@/app/api/storage/backends/route');
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it('returns the list of backends with masked secrets', async () => {
    const req = new Request('http://localhost/api/storage/backends');
    const res = await route.GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.backends).toHaveLength(2);
    expect(body.default_backend_id).toBe('b-1');
    const dipol = body.backends.find(b => b.id === 'b-1');
    expect(dipol.config.access_key_id).toMatch(/\*+/);
    expect(dipol.config.secret_access_key).toMatch(/\*+/);
    expect(dipol.config.bucket).toBe('b');
    expect(dipol.config.region).toBe('us-east-1');
  });
});

describe('POST /api/storage/backends', () => {
  let route;
  let storage;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('@/lib/storage', () => ({
      getConfig: vi.fn(),
      addBackend: vi.fn(async () => 'b-new'),
      removeBackend: vi.fn(),
      setDefaultBackend: vi.fn(),
    }));
    vi.doMock('@/lib/s3Store', () => ({ pingS3: vi.fn(async () => undefined) }));
    vi.doMock('@/lib/mongoStore', () => ({ pingMongo: vi.fn(async () => undefined) }));
    vi.doMock('@/lib/auth', () => ({ withAuth: (fn) => fn }));
    storage = await import('@/lib/storage');
    route = await import('@/app/api/storage/backends/route');
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it('400 when name or driver missing', async () => {
    const req = new Request('http://localhost/api/storage/backends', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ driver: 's3' }),
    });
    const res = await route.POST(req);
    expect(res.status).toBe(400);
  });

  it('pings the backend before adding', async () => {
    const { pingS3 } = await import('@/lib/s3Store');
    const req = new Request('http://localhost/api/storage/backends', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'New S3',
        driver: 's3',
        config: { bucket: 'b', region: 'us-east-1', access_key_id: 'k', secret_access_key: 's' },
      }),
    });
    const res = await route.POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe('b-new');
    expect(pingS3).toHaveBeenCalled();
    expect(storage.addBackend).toHaveBeenCalled();
  });

  it('400 when ping fails', async () => {
    const { pingS3 } = await import('@/lib/s3Store');
    pingS3.mockRejectedValueOnce(new Error('forbidden'));
    const req = new Request('http://localhost/api/storage/backends', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Bad S3',
        driver: 's3',
        config: { bucket: 'b', region: 'us-east-1', access_key_id: 'k', secret_access_key: 's' },
      }),
    });
    const res = await route.POST(req);
    expect(res.status).toBe(400);
    expect(storage.addBackend).not.toHaveBeenCalled();
  });
});

describe('PATCH/DELETE /api/storage/backends/[id]', () => {
  let route;
  let storage;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('@/lib/storage', () => ({
      getConfig: vi.fn(async () => ({
        v: 2,
        backends: [
          { id: 'local', name: 'Local', driver: 'file', config: {} },
          {
            id: 'b-1',
            name: 'Dipol',
            driver: 's3',
            config: {
              bucket: 'old-bucket',
              region: 'us-east-1',
              access_key_id: 'OLDKEY',
              secret_access_key: 'OLDSECRET',
              prefix: '',
              force_path_style: false,
            },
          },
          {
            id: 'b-2',
            name: 'Mongo',
            driver: 'mongo',
            config: { uri: 'mongodb://old-host', database: 'pulse' },
          },
        ],
        default_backend_id: 'local',
      })),
      addBackend: vi.fn(),
      removeBackend: vi.fn(),
      setDefaultBackend: vi.fn(),
      updateBackend: vi.fn(async () => undefined),
    }));
    vi.doMock('@/lib/projectIndex', () => ({
      listAllProjects: vi.fn(async () => []),
    }));
    vi.doMock('@/lib/s3Store', () => ({ pingS3: vi.fn(async () => undefined) }));
    vi.doMock('@/lib/mongoStore', () => ({ pingMongo: vi.fn(async () => undefined) }));
    vi.doMock('@/lib/auth', () => ({ withAuth: (fn) => fn }));
    storage = await import('@/lib/storage');
    route = await import('@/app/api/storage/backends/[id]/route');
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it('PATCH set_default delegates to setDefaultBackend', async () => {
    const req = new Request('http://localhost/api/storage/backends/b-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ set_default: true }),
    });
    const res = await route.PATCH(req, { params: Promise.resolve({ id: 'b-1' }) });
    expect(res.status).toBe(200);
    expect(storage.setDefaultBackend).toHaveBeenCalledWith('b-1');
  });

  it('PATCH edit S3 with new secret pings and persists the new config', async () => {
    const { pingS3 } = await import('@/lib/s3Store');
    const req = new Request('http://localhost/api/storage/backends/b-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Dipol Updated',
        config: {
          bucket: 'new-bucket',
          region: 'us-west-2',
          access_key_id: 'NEWKEY',
          secret_access_key: 'NEWSECRET',
          prefix: 'pulse/',
          force_path_style: true,
        },
      }),
    });
    const res = await route.PATCH(req, { params: Promise.resolve({ id: 'b-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.detail_key).toBe('success.storage.backend_updated');
    // Response must mask secrets — same defense as GET /api/storage/backends.
    expect(body.backend.config.access_key_id).toBe('********');
    expect(body.backend.config.secret_access_key).toBe('********');
    expect(body.backend.config.bucket).toBe('new-bucket');
    expect(pingS3).toHaveBeenCalledTimes(1);
    const persisted = storage.updateBackend.mock.calls[0];
    expect(persisted[0]).toBe('b-1');
    expect(persisted[1]).toMatchObject({
      name: 'Dipol Updated',
      config: expect.objectContaining({
        bucket: 'new-bucket',
        region: 'us-west-2',
        access_key_id: 'NEWKEY',
        secret_access_key: 'NEWSECRET',
      }),
    });
  });

  it('PATCH edit S3 keeps the existing secret when "********" is sent', async () => {
    const { pingS3 } = await import('@/lib/s3Store');
    const req = new Request('http://localhost/api/storage/backends/b-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Dipol Updated',
        config: {
          bucket: 'new-bucket',
          region: 'us-east-1',
          access_key_id: '********',
          secret_access_key: '********',
        },
      }),
    });
    const res = await route.PATCH(req, { params: Promise.resolve({ id: 'b-1' }) });
    expect(res.status).toBe(200);
    expect(pingS3).toHaveBeenCalledTimes(1);
    const pingArg = pingS3.mock.calls[0][0];
    expect(pingArg.access_key_id).toBe('OLDKEY');
    expect(pingArg.secret_access_key).toBe('OLDSECRET');
    const persisted = storage.updateBackend.mock.calls[0][1];
    expect(persisted.config.access_key_id).toBe('OLDKEY');
    expect(persisted.config.secret_access_key).toBe('OLDSECRET');
    expect(persisted.config.bucket).toBe('new-bucket');
  });

  it('PATCH edit S3 keeps existing secret when the field is cleared (empty string)', async () => {
    const { pingS3 } = await import('@/lib/s3Store');
    const req = new Request('http://localhost/api/storage/backends/b-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Dipol Renamed',
        config: {
          bucket: 'old-bucket',
          region: 'us-east-1',
          access_key_id: '',
          secret_access_key: '   ',
        },
      }),
    });
    const res = await route.PATCH(req, { params: Promise.resolve({ id: 'b-1' }) });
    expect(res.status).toBe(200);
    const pingArg = pingS3.mock.calls[0][0];
    expect(pingArg.access_key_id).toBe('OLDKEY');
    expect(pingArg.secret_access_key).toBe('OLDSECRET');
    const persisted = storage.updateBackend.mock.calls[0][1];
    expect(persisted.config.access_key_id).toBe('OLDKEY');
    expect(persisted.config.secret_access_key).toBe('OLDSECRET');
  });

  it('PATCH edit Mongo keeps existing URI when "********" is sent', async () => {
    const { pingMongo } = await import('@/lib/mongoStore');
    const req = new Request('http://localhost/api/storage/backends/b-2', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Mongo Updated',
        config: { uri: '********', database: 'pulse-prod' },
      }),
    });
    const res = await route.PATCH(req, { params: Promise.resolve({ id: 'b-2' }) });
    expect(res.status).toBe(200);
    const pingArg = pingMongo.mock.calls[0][0];
    expect(pingArg.uri).toBe('mongodb://old-host');
    expect(pingArg.database).toBe('pulse-prod');
    const persisted = storage.updateBackend.mock.calls[0][1];
    expect(persisted.config.uri).toBe('mongodb://old-host');
    expect(persisted.config.database).toBe('pulse-prod');
  });

  it('PATCH edit returns 400 when ping fails and does not persist', async () => {
    const { pingS3 } = await import('@/lib/s3Store');
    pingS3.mockRejectedValueOnce(new Error('forbidden'));
    const req = new Request('http://localhost/api/storage/backends/b-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Dipol Updated',
        config: {
          bucket: 'new-bucket',
          region: 'us-east-1',
          access_key_id: 'NEWKEY',
          secret_access_key: 'NEWSECRET',
        },
      }),
    });
    const res = await route.PATCH(req, { params: Promise.resolve({ id: 'b-1' }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.detail_key).toBe('errors.backend_unreachable');
    expect(storage.updateBackend).not.toHaveBeenCalled();
  });

  it('PATCH edit returns 404 for unknown backend id', async () => {
    const req = new Request('http://localhost/api/storage/backends/b-missing', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'X',
        config: { bucket: 'b', region: 'us-east-1', access_key_id: 'k', secret_access_key: 's' },
      }),
    });
    const res = await route.PATCH(req, { params: Promise.resolve({ id: 'b-missing' }) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.detail_key).toBe('errors.backend_unknown');
    expect(storage.updateBackend).not.toHaveBeenCalled();
  });

  it('PATCH edit refuses to mutate the local backend', async () => {
    const req = new Request('http://localhost/api/storage/backends/local', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'X', config: {} }),
    });
    const res = await route.PATCH(req, { params: Promise.resolve({ id: 'local' }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.detail_key).toBe('errors.backend_local_immutable');
    expect(storage.updateBackend).not.toHaveBeenCalled();
  });

  it('DELETE refuses to remove the local backend', async () => {
    const req = new Request('http://localhost/api/storage/backends/local', { method: 'DELETE' });
    const res = await route.DELETE(req, { params: Promise.resolve({ id: 'local' }) });
    expect(res.status).toBe(400);
    expect(storage.removeBackend).not.toHaveBeenCalled();
  });

  it('DELETE refuses when projects still use the backend', async () => {
    const { listAllProjects } = await import('@/lib/projectIndex');
    listAllProjects.mockResolvedValueOnce([
      { id: 'p1', name: 'X', backend_id: 'b-1' },
    ]);
    const req = new Request('http://localhost/api/storage/backends/b-1', { method: 'DELETE' });
    const res = await route.DELETE(req, { params: Promise.resolve({ id: 'b-1' }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.detail_key).toBe('errors.backend_in_use');
    expect(storage.removeBackend).not.toHaveBeenCalled();
  });

  it('DELETE removes the backend when nothing depends on it', async () => {
    const req = new Request('http://localhost/api/storage/backends/b-1', { method: 'DELETE' });
    const res = await route.DELETE(req, { params: Promise.resolve({ id: 'b-1' }) });
    expect(res.status).toBe(200);
    expect(storage.removeBackend).toHaveBeenCalledWith('b-1');
  });
});
