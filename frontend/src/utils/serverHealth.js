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
  const t1 = timeoutSignal(3500);
  try {
    const health = await fetch(`${base}/health`, { signal: t1.signal });
    if (!health.ok) return { ok: false, reason: 'health_fail' };
  } catch (err) {
    const isTimeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    return { ok: false, reason: isTimeout ? 'timeout' : 'unreachable' };
  } finally {
    t1.cancel();
  }

  const t2 = timeoutSignal(3500);
  try {
    const auth = await fetch(`${base}/api/sessions`, {
      headers: { 'X-API-Key': server.apiKey },
      signal: t2.signal,
    });
    if (auth.status === 401) return { ok: false, reason: 'bad_key' };
    if (!auth.ok) return { ok: false, reason: 'unknown' };
    return { ok: true };
  } catch (err) {
    const isTimeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    return { ok: false, reason: isTimeout ? 'timeout' : 'unreachable' };
  } finally {
    t2.cancel();
  }
}
