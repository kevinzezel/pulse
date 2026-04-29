import { promises as fs } from 'fs';
import { dirname, join, normalize, isAbsolute } from 'path';

// Default base dir for the singleton facade. `process.cwd()` is fine in dev,
// but under systemd the worker process that handles writes can drift to a
// different cwd than the unit's WorkingDirectory — sessions.json silently
// stops updating even though `fetch('/api/sessions', { method: 'PUT' })`
// answers 200. The unit and launchd plist set PULSE_FRONTEND_ROOT to the
// install dir; we prefer that when present and fall back to cwd.
const DEFAULT_DATA_DIR = process.env.PULSE_FRONTEND_ROOT || process.cwd();
const _locks = new Map();

export class FileDriver {
  constructor(config = {}) {
    this.dataDir = config.dataDir || DEFAULT_DATA_DIR;
  }

  async init() {
    await fs.mkdir(this.dataDir, { recursive: true });
  }

  async close() {
    // No-op for file driver.
  }

  _resolvePath(relPath) {
    const normalized = normalize(relPath);
    if (isAbsolute(normalized) || normalized.startsWith('..')) {
      throw new Error(`Invalid relPath: ${relPath}`);
    }
    return join(this.dataDir, normalized);
  }

  async readJsonFile(relPath, fallback) {
    const full = this._resolvePath(relPath);
    try {
      const text = await fs.readFile(full, 'utf-8');
      if (!text.trim()) return fallback;
      return JSON.parse(text);
    } catch (err) {
      if (err.code === 'ENOENT') return fallback;
      throw err;
    }
  }

  async writeJsonFileAtomic(relPath, data) {
    const full = this._resolvePath(relPath);
    await fs.mkdir(dirname(full), { recursive: true });
    const tmp = `${full}.tmp-${process.pid}-${Date.now()}`;
    try {
      await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
      await fs.rename(tmp, full);
    } catch (err) {
      try { await fs.unlink(tmp); } catch {}
      // Surface the actual filesystem path in the server log so users can
      // diagnose cwd / permission issues from `pulse logs dashboard`.
      console.error(`[jsonStore] writeJsonFileAtomic failed for ${full}:`, err);
      throw err;
    }
  }

  async deleteFile(relPath) {
    const full = this._resolvePath(relPath);
    try {
      await fs.unlink(full);
      return true;
    } catch (err) {
      if (err.code === 'ENOENT') return false;
      throw err;
    }
  }

  async withFileLock(relPath, mutator) {
    const key = `${this.dataDir}::${relPath}`;
    const previous = _locks.get(key) || Promise.resolve();
    const run = (async () => {
      try { await previous; } catch {}
      return await mutator();
    })();
    _locks.set(key, run);
    try {
      return await run;
    } finally {
      if (_locks.get(key) === run) _locks.delete(key);
    }
  }

  // Returns null — file driver doesn't have a "client" to drain.
  beginReload() {
    return null;
  }
}

// Backwards-compatible singleton facade. Other code calls these without
// instantiating a driver. Used by storage.js compat layer until Plan 2
// migrates callers to the registry.
let _defaultInstance = null;

function _instance() {
  if (!_defaultInstance) {
    _defaultInstance = new FileDriver({});
  }
  return _defaultInstance;
}

export async function readJsonFile(relPath, fallback) {
  return _instance().readJsonFile(relPath, fallback);
}

export async function writeJsonFileAtomic(relPath, data) {
  return _instance().writeJsonFileAtomic(relPath, data);
}

export async function withFileLock(relPath, mutator) {
  return _instance().withFileLock(relPath, mutator);
}
