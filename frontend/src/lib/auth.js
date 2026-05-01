import { SignJWT, jwtVerify } from 'jose';
import { NextResponse } from 'next/server';

const COOKIE_NAME = 'rt_auth';
const LEGACY_COOKIE_NAME = 'rt:auth';
const JWT_ALG = 'HS256';
const SESSION_TTL_SECONDS = 24 * 60 * 60;

function getSecret() {
  const s = process.env.AUTH_JWT_SECRET;
  if (!s) throw new Error('AUTH_JWT_SECRET env var required');
  return new TextEncoder().encode(s);
}

export function getCookieName() {
  return COOKIE_NAME;
}

export function getCookieNames() {
  return [COOKIE_NAME, LEGACY_COOKIE_NAME];
}

export function getSessionTokenFromCookies(cookies) {
  return cookies.get(COOKIE_NAME)?.value || cookies.get(LEGACY_COOKIE_NAME)?.value;
}

export async function createSessionToken() {
  return await new SignJWT({ sub: 'user' })
    .setProtectedHeader({ alg: JWT_ALG })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getSecret());
}

export async function verifySessionToken(token) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: [JWT_ALG] });
    return payload;
  } catch {
    return null;
  }
}

export function getCookieOptions() {
  const secure = (process.env.AUTH_COOKIE_SECURE ?? 'true').toLowerCase() !== 'false';
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  };
}

export function isValidPassword(input) {
  const expected = process.env.AUTH_PASSWORD;
  if (!expected) throw new Error('AUTH_PASSWORD env var required');
  if (typeof input !== 'string' || input.length === 0) return false;
  if (input.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < input.length; i++) {
    diff |= input.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

export function withAuth(handler) {
  return async (request, ctx) => {
    const token = getSessionTokenFromCookies(request.cookies);
    const session = await verifySessionToken(token);
    if (!session) {
      return NextResponse.json(
        { detail: 'Unauthorized', detail_key: 'errors.unauthorized' },
        { status: 401 }
      );
    }
    try {
      return await handler(request, ctx);
    } catch (err) {
      // v5.0: an install whose storage-config.json still references `mongo`
      // surfaces UnsupportedDriverError from getConfig / getDriverFor anywhere
      // a route reads project state. Catch it here so EVERY auth-gated route
      // returns the structured `errors.storage.unsupported_driver` payload
      // instead of a generic 500. Duck-typed -- importing the class from
      // storage.js would pull the file/S3 drivers into the middleware bundle,
      // which runs on Edge Runtime and rejects `process.cwd()`.
      if (err && err.name === 'UnsupportedDriverError' && typeof err.detailKey === 'string') {
        return NextResponse.json(
          {
            detail: err.message,
            detail_key: err.detailKey,
            detail_params: { driver: err.driver },
          },
          { status: 503 },
        );
      }
      throw err;
    }
  };
}
