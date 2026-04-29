// Pulse backend share tokens encode a JSON payload as base64url and prefix it
// with `pulsebackend://v1/`. They contain credentials in plaintext — anyone
// with the token has full access to the backend until the underlying IAM key
// is rotated. Format is versioned so we can evolve it without breaking
// existing deployments.

const PREFIX = 'pulsebackend://v1/';
const PAYLOAD_TYPE = 'pulse-backend-share';
const PAYLOAD_VERSION = 1;

export class BackendTokenError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BackendTokenError';
  }
}

function toBase64Url(str) {
  return Buffer.from(str, 'utf-8').toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromBase64Url(b64url) {
  const pad = (4 - (b64url.length % 4)) % 4;
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad);
  return Buffer.from(b64, 'base64').toString('utf-8');
}

export function encodeBackendToken(backend) {
  if (!backend || typeof backend !== 'object') {
    throw new BackendTokenError('encodeBackendToken: backend object is required');
  }
  const payload = {
    v: PAYLOAD_VERSION,
    type: PAYLOAD_TYPE,
    backend,
  };
  return PREFIX + toBase64Url(JSON.stringify(payload));
}

export function decodeBackendToken(token) {
  if (typeof token !== 'string' || !token.startsWith('pulsebackend://')) {
    throw new BackendTokenError(`Invalid token: missing ${PREFIX} prefix`);
  }
  const versionMatch = token.match(/^pulsebackend:\/\/v(\d+)\//);
  if (!versionMatch || Number(versionMatch[1]) !== PAYLOAD_VERSION) {
    throw new BackendTokenError(`Unsupported token version: ${versionMatch?.[1] || 'unknown'}`);
  }
  const b64url = token.slice(PREFIX.length);
  let json;
  try {
    json = fromBase64Url(b64url);
  } catch (err) {
    throw new BackendTokenError(`Invalid token: base64 decode failed`);
  }
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new BackendTokenError(`Invalid token: JSON parse failed`);
  }
  if (!parsed || parsed.type !== PAYLOAD_TYPE) {
    throw new BackendTokenError(`Invalid token: type marker mismatch`);
  }
  if (!parsed.backend || typeof parsed.backend !== 'object') {
    throw new BackendTokenError(`Invalid token: missing backend payload`);
  }
  if (!parsed.backend.driver || !parsed.backend.config) {
    throw new BackendTokenError(`Invalid token: backend missing driver/config`);
  }
  return { v: parsed.v, backend: parsed.backend };
}
