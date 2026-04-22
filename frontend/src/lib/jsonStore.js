import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

// Resolve the base dir we read/write JSON stores against. `process.cwd()` is
// fine in dev (we're run from the frontend dir), but under systemd the worker
// process that actually handles writes can end up with a different cwd than
// the unit's `WorkingDirectory` — sessions.json silently stops updating even
// though `fetch('/api/sessions', { method: 'PUT' })` responds 200. The unit
// and launchd plist now set `PULSE_FRONTEND_ROOT` to the install dir; we
// prefer that when present. Kept `process.cwd()` as the dev fallback.
const FRONTEND_ROOT = process.env.PULSE_FRONTEND_ROOT || process.cwd();

export async function readJsonFile(relPath, fallback) {
  const file = path.join(FRONTEND_ROOT, relPath);
  try {
    const txt = await fs.readFile(file, 'utf-8');
    return JSON.parse(txt);
  } catch (err) {
    if (err?.code === 'ENOENT') return fallback;
    throw err;
  }
}

export async function writeJsonFileAtomic(relPath, data) {
  const file = path.join(FRONTEND_ROOT, relPath);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
    await fs.rename(tmp, file);
  } catch (err) {
    try { await fs.unlink(tmp); } catch {}
    // Surface the actual filesystem path in the server log so users can
    // diagnose cwd / permission issues from `pulse logs dashboard`.
    console.error(`[jsonStore] writeJsonFileAtomic failed for ${file}:`, err);
    throw err;
  }
}

const fileLocks = new Map();

// Serializes concurrent mutators on the same relPath to prevent
// read-modify-write races across request handlers.
export async function withFileLock(relPath, mutator) {
  const previous = fileLocks.get(relPath) || Promise.resolve();
  const run = (async () => {
    try { await previous; } catch {}
    return await mutator();
  })();
  fileLocks.set(relPath, run);
  try {
    return await run;
  } finally {
    if (fileLocks.get(relPath) === run) {
      fileLocks.delete(relPath);
    }
  }
}
