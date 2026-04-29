import { describe, it, expect } from 'vitest';
import { encodeBackendToken, decodeBackendToken, BackendTokenError } from '../backendToken.js';

describe('backendToken', () => {
  const validBackend = {
    name: 'Dipol',
    driver: 's3',
    config: {
      endpoint: 'https://storage.googleapis.com',
      bucket: 'prd-pulse',
      region: 'southamerica-east1',
      access_key_id: 'GOOG-FAKE',
      secret_access_key: 'fake-secret',
      prefix: '',
      force_path_style: false,
    },
  };

  it('encode produces a string starting with pulsebackend://v1/', () => {
    const token = encodeBackendToken(validBackend);
    expect(typeof token).toBe('string');
    expect(token.startsWith('pulsebackend://v1/')).toBe(true);
  });

  it('encoded token uses base64url (no +, /, =)', () => {
    const backendWithLongSecret = {
      name: 'Test',
      driver: 's3',
      config: { secret_access_key: '\xff\xfe\xfd-test+/=padding' },
    };
    const token = encodeBackendToken(backendWithLongSecret);
    const payload = token.slice('pulsebackend://v1/'.length);
    expect(payload).not.toMatch(/[+/=]/);
  });

  it('encode + decode round-trip preserves the backend payload', () => {
    const token = encodeBackendToken(validBackend);
    const decoded = decodeBackendToken(token);
    expect(decoded.backend).toEqual(validBackend);
  });

  it('decode rejects tokens without the magic prefix', () => {
    expect(() => decodeBackendToken('https://example.com/notatoken'))
      .toThrow(BackendTokenError);
    expect(() => decodeBackendToken('eyJ2IjoxfQ'))
      .toThrow(/prefix/i);
  });

  it('decode rejects tokens with the wrong version', () => {
    // v2 doesn't exist yet — should reject so we can version the format later
    expect(() => decodeBackendToken('pulsebackend://v2/abc'))
      .toThrow(/version/i);
  });

  it('decode rejects malformed base64', () => {
    expect(() => decodeBackendToken('pulsebackend://v1/!!!not-base64!!!'))
      .toThrow(BackendTokenError);
  });

  it('decode rejects valid base64 that is not valid JSON', () => {
    // base64url("not json") = "bm90IGpzb24"
    expect(() => decodeBackendToken('pulsebackend://v1/bm90IGpzb24'))
      .toThrow(/json/i);
  });

  it('decode rejects JSON missing the type marker', () => {
    // Encode a payload without the pulse-backend-share type
    const badPayload = JSON.stringify({ v: 1, type: 'something-else', backend: validBackend });
    const b64 = Buffer.from(badPayload, 'utf-8').toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    expect(() => decodeBackendToken(`pulsebackend://v1/${b64}`))
      .toThrow(/type/i);
  });

  it('decode rejects backend payload missing required fields', () => {
    const badBackend = { name: 'X', driver: 's3' }; // missing config
    const token = encodeBackendToken(badBackend);
    expect(() => decodeBackendToken(token)).toThrow(/config/i);
  });
});
