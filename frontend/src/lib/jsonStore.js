import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

export async function readJsonFile(relPath, fallback) {
  const file = path.join(process.cwd(), relPath);
  try {
    const txt = await fs.readFile(file, 'utf-8');
    return JSON.parse(txt);
  } catch (err) {
    if (err?.code === 'ENOENT') return fallback;
    throw err;
  }
}

export async function writeJsonFileAtomic(relPath, data) {
  const file = path.join(process.cwd(), relPath);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
    await fs.rename(tmp, file);
  } catch (err) {
    try { await fs.unlink(tmp); } catch {}
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
