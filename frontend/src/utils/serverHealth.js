export const SERVER_HEALTH_TIMEOUT_MS = 1000;

export function timeoutSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return { signal: AbortSignal.timeout(ms), cancel: () => {} };
  }
  const controller = new AbortController();
  const handle = setTimeout(() => controller.abort(new DOMException('timeout', 'TimeoutError')), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(handle) };
}

export function isMixedContent(server) {
  if (typeof window === 'undefined') return false;
  return window.location.protocol === 'https:' && server?.protocol === 'http';
}

export async function testServer(server) {
  if (isMixedContent(server)) {
    return { ok: false, reason: 'mixed_content' };
  }

  const scheme = server.protocol === 'https' ? 'https' : 'http';
  const base = `${scheme}://${server.host}:${server.port}`;
  const t = timeoutSignal(SERVER_HEALTH_TIMEOUT_MS);
  try {
    const auth = await fetch(`${base}/health`, {
      headers: { 'X-API-Key': server.apiKey },
      signal: t.signal,
    });
    if (auth.status === 401) return { ok: false, reason: 'bad_key' };
    if (!auth.ok) return { ok: false, reason: 'unknown' };
    return { ok: true };
  } catch (err) {
    const isTimeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    return { ok: false, reason: isTimeout ? 'timeout' : 'unreachable' };
  } finally {
    t.cancel();
  }
}
