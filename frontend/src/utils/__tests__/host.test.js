import { describe, it, expect, afterEach } from 'vitest';
import { isLocalHost, isServerLocalToBrowser, buildRemoteEditorUrl } from '../host.js';

// host.js reads `window.location.hostname` to decide whether the browser is on
// loopback. The vitest config runs `environment: 'node'`, so we install a tiny
// shim per test instead of pulling in jsdom.
function setBrowserHost(hostname) {
  globalThis.window = { location: { hostname } };
}

function clearBrowser() {
  delete globalThis.window;
}

// File-scope cleanup: any test that calls setBrowserHost (or that should run
// without window even after another test installed it) gets a fresh global.
// Hoisted out of individual describe blocks so the buildRemoteEditorUrl block
// can't accidentally inherit a stale window from a prior test.
afterEach(clearBrowser);

describe('isLocalHost', () => {
  it('returns false in non-browser contexts', () => {
    clearBrowser();
    expect(isLocalHost()).toBe(false);
  });

  it('returns true on localhost', () => {
    setBrowserHost('localhost');
    expect(isLocalHost()).toBe(true);
  });

  it('returns true on 127.0.0.1', () => {
    setBrowserHost('127.0.0.1');
    expect(isLocalHost()).toBe(true);
  });

  it('returns true on ::1', () => {
    setBrowserHost('::1');
    expect(isLocalHost()).toBe(true);
  });

  it('returns false on a LAN IP', () => {
    setBrowserHost('192.168.0.130');
    expect(isLocalHost()).toBe(false);
  });
});

describe('isServerLocalToBrowser', () => {
  it('treats localhost browser + localhost server as local', () => {
    setBrowserHost('localhost');
    expect(isServerLocalToBrowser({ host: 'localhost' })).toBe(true);
  });

  it('treats localhost browser + 127.0.0.1 server as local (mixed loopback)', () => {
    setBrowserHost('localhost');
    expect(isServerLocalToBrowser({ host: '127.0.0.1' })).toBe(true);
  });

  it('treats localhost browser + ::1 server as local', () => {
    setBrowserHost('localhost');
    expect(isServerLocalToBrowser({ host: '::1' })).toBe(true);
  });

  it('treats LAN-IP browser + same LAN-IP server as REMOTE (no hidden probe)', () => {
    // Regression: 4.2.x ran a hidden probe to https://localhost:<port>/health
    // and could "promote" a LAN-IP server to local. That probe was removed in
    // 4.2.9-pre, so the same scenario must now stay remote.
    setBrowserHost('192.168.0.130');
    expect(isServerLocalToBrowser({ host: '192.168.0.130' })).toBe(false);
  });

  it('treats LAN-IP browser + localhost server as remote', () => {
    setBrowserHost('192.168.0.130');
    expect(isServerLocalToBrowser({ host: 'localhost' })).toBe(false);
  });

  it('treats localhost browser + LAN-IP server as remote', () => {
    setBrowserHost('localhost');
    expect(isServerLocalToBrowser({ host: '192.168.0.130' })).toBe(false);
  });

  it('returns false for null/empty server', () => {
    setBrowserHost('localhost');
    expect(isServerLocalToBrowser(null)).toBe(false);
    expect(isServerLocalToBrowser({})).toBe(false);
    expect(isServerLocalToBrowser({ host: '' })).toBe(false);
  });

  it('returns false in non-browser contexts', () => {
    clearBrowser();
    expect(isServerLocalToBrowser({ host: 'localhost' })).toBe(false);
  });
});

describe('buildRemoteEditorUrl', () => {
  it('uses sshAlias when set', () => {
    const url = buildRemoteEditorUrl({ sshAlias: 'dev-box', host: '10.0.0.1' }, '/home/u');
    expect(url).toBe('vscode://vscode-remote/ssh-remote+dev-box/home/u');
  });

  it('falls back to host when sshAlias is empty', () => {
    expect(buildRemoteEditorUrl({ sshAlias: '   ', host: '10.0.0.1' }, '/srv/app'))
      .toBe('vscode://vscode-remote/ssh-remote+10.0.0.1/srv/app');
  });

  it('encodes path segments but preserves the slashes', () => {
    expect(buildRemoteEditorUrl({ host: 'box' }, '/Users/me/My Project'))
      .toBe('vscode://vscode-remote/ssh-remote+box/Users/me/My%20Project');
  });

  it('returns null when target or cwd is missing', () => {
    expect(buildRemoteEditorUrl({}, '/x')).toBeNull();
    expect(buildRemoteEditorUrl({ host: 'box' }, '')).toBeNull();
  });
});
