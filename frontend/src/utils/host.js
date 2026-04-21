const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1']);

export function isLocalHost() {
  if (typeof window === 'undefined') return false;
  return LOOPBACK.has(window.location.hostname);
}

export function isServerLocalToBrowser(server) {
  if (typeof window === 'undefined' || !server) return false;
  const browserHost = window.location.hostname;
  const serverHost = server.host;
  if (!serverHost) return false;
  if (LOOPBACK.has(browserHost) && LOOPBACK.has(serverHost)) return true;
  return browserHost === serverHost;
}
