import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { withAuth } from '@/lib/auth';
import { withFileLock } from '@/lib/jsonStore';

const FILE = path.join(process.cwd(), 'data', 'prompts.json');
const LOCK_KEY = 'data/prompts.json';

async function readPrompts() {
  try {
    const raw = await fs.readFile(FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.prompts) ? parsed.prompts : [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function atomicWrite(prompts) {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify({ prompts }, null, 2), 'utf-8');
    await fs.rename(tmp, FILE);
  } catch (err) {
    await fs.unlink(tmp).catch(() => {});
    throw err;
  }
}

function normalize(list) {
  const now = new Date().toISOString();
  return list.map((p) => {
    // project_id: string = scoped to that project; null = global (explicitly shared across projects).
    const projectId = (typeof p.project_id === 'string' && p.project_id) ? p.project_id : null;
    return {
      id: p.id || `pid-${randomUUID()}`,
      name: String(p.name ?? '').trim(),
      body: typeof p.body === 'string' ? p.body : '',
      created_at: p.created_at || now,
      updated_at: p.updated_at || now,
      project_id: projectId,
    };
  });
}

export const GET = withAuth(async () => {
  const prompts = await readPrompts();
  return NextResponse.json({ prompts });
});

export const PUT = withAuth(async (req) => {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ detail: 'Invalid JSON', detail_key: 'errors.invalid_body' }, { status: 400 });
  }
  if (!body || !Array.isArray(body.prompts)) {
    return NextResponse.json({ detail: 'Expected { prompts: [...] }', detail_key: 'errors.invalid_body' }, { status: 400 });
  }
  const prompts = await withFileLock(LOCK_KEY, async () => {
    const next = normalize(body.prompts);
    await atomicWrite(next);
    return next;
  });
  return NextResponse.json({ prompts });
});
