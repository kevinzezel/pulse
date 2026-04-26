import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { withAuth } from '@/lib/auth';
import { readStore, writeStore, withStoreLock } from '@/lib/storage';

const REL = 'data/prompts.json';
const EMPTY = { prompts: [] };

async function readPrompts() {
  const data = await readStore(REL, EMPTY);
  return Array.isArray(data?.prompts) ? data.prompts : [];
}

function normalize(list) {
  const now = new Date().toISOString();
  return list.map((p) => {
    const projectId = (typeof p.project_id === 'string' && p.project_id) ? p.project_id : null;
    const groupId = (typeof p.group_id === 'string' && p.group_id) ? p.group_id : null;
    return {
      id: p.id || `pid-${randomUUID()}`,
      name: String(p.name ?? '').trim(),
      body: typeof p.body === 'string' ? p.body : '',
      created_at: p.created_at || now,
      updated_at: p.updated_at || now,
      project_id: projectId,
      group_id: groupId,
      pinned: p.pinned === true,
    };
  });
}

export const GET = withAuth(async () => {
  const prompts = normalize(await readPrompts());
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
  const prompts = await withStoreLock(REL, async () => {
    const next = normalize(body.prompts);
    await writeStore(REL, { prompts: next });
    return next;
  });
  return NextResponse.json({ prompts });
});
