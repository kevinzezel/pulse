import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('GET/PUT /api/intelligence-config', () => {
  let route;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('@/lib/projectStorage', () => ({
      readLocalStore: vi.fn(async () => ({
        providers: {
          gemini: {
            api_key: 'AIzaSecretKeyValue123',
            model: 'gemini-2.5-flash',
            updated_at: '2026-04-30T10:00:00.000Z',
          },
        },
        updated_at: '2026-04-30T10:00:00.000Z',
      })),
      writeLocalStore: vi.fn(async () => undefined),
      withLocalStoreLock: vi.fn(async (_p, fn) => fn()),
    }));
    vi.doMock('@/lib/auth', () => ({ withAuth: (fn) => fn }));
    route = await import('@/app/api/intelligence-config/route');
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it('default GET masks the key and never includes the raw value', async () => {
    const req = new Request('http://localhost/api/intelligence-config');
    const res = await route.GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.providers.gemini.configured).toBe(true);
    expect(body.providers.gemini.masked).toMatch(/•+/);
    expect(JSON.stringify(body)).not.toContain('AIzaSecretKeyValue123');
    expect(body.providers.gemini.api_key).toBeUndefined();
  });

  it('GET ?reveal=gemini returns the raw key for the configured provider', async () => {
    const req = new Request('http://localhost/api/intelligence-config?reveal=gemini');
    const res = await route.GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.provider).toBe('gemini');
    expect(body.api_key).toBe('AIzaSecretKeyValue123');
  });

  it('GET ?reveal=gemini fails with localized error when not configured', async () => {
    const projectStorage = await import('@/lib/projectStorage');
    projectStorage.readLocalStore.mockResolvedValueOnce({ providers: {}, updated_at: null });
    const req = new Request('http://localhost/api/intelligence-config?reveal=gemini');
    const res = await route.GET(req);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.detail_key).toBe('errors.intelligence.gemini.not_configured');
    expect(body.api_key).toBeUndefined();
  });

  it('GET ?reveal=unknownProvider rejects with invalid_body', async () => {
    const req = new Request('http://localhost/api/intelligence-config?reveal=openai');
    const res = await route.GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.detail_key).toBe('errors.intelligence.unknown_provider');
  });

  it('PUT preserves the saved key when api_key is omitted', async () => {
    const projectStorage = await import('@/lib/projectStorage');
    const req = new Request('http://localhost/api/intelligence-config', {
      method: 'PUT',
      body: JSON.stringify({ gemini: { model: 'gemini-2.5-flash-lite' } }),
    });
    const res = await route.PUT(req);
    expect(res.status).toBe(200);
    expect(projectStorage.writeLocalStore).toHaveBeenCalledWith(
      'data/intelligence-config.json',
      expect.objectContaining({
        providers: expect.objectContaining({
          gemini: expect.objectContaining({
            api_key: 'AIzaSecretKeyValue123',
            model: 'gemini-2.5-flash-lite',
          }),
        }),
      }),
    );
  });

  it('PUT clears the saved key when api_key is explicitly empty', async () => {
    const projectStorage = await import('@/lib/projectStorage');
    const req = new Request('http://localhost/api/intelligence-config', {
      method: 'PUT',
      body: JSON.stringify({ gemini: { api_key: '', model: 'gemini-2.5-flash' } }),
    });
    const res = await route.PUT(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.providers.gemini.configured).toBe(false);
    expect(projectStorage.writeLocalStore).toHaveBeenCalledWith(
      'data/intelligence-config.json',
      expect.objectContaining({
        providers: expect.objectContaining({
          gemini: expect.objectContaining({
            api_key: '',
            model: 'gemini-2.5-flash',
          }),
        }),
      }),
    );
  });

  it('PUT rejects an empty key when no key exists yet', async () => {
    const projectStorage = await import('@/lib/projectStorage');
    projectStorage.readLocalStore.mockResolvedValueOnce({ providers: {}, updated_at: null });
    const req = new Request('http://localhost/api/intelligence-config', {
      method: 'PUT',
      body: JSON.stringify({ gemini: { api_key: '', model: 'gemini-2.5-flash' } }),
    });
    const res = await route.PUT(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.detail_key).toBe('errors.intelligence.gemini.api_key_required');
  });
});
