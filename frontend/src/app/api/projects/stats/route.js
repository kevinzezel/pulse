import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { withAuth } from '@/lib/auth';

async function readArray(relPath, key) {
  const file = path.join(process.cwd(), relPath);
  try {
    const raw = await fs.readFile(file, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.[key]) ? parsed[key] : [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function readSessions() {
  const file = path.join(process.cwd(), 'data', 'sessions.json');
  try {
    const raw = await fs.readFile(file, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.servers !== 'object') return [];
    const out = [];
    for (const list of Object.values(parsed.servers)) {
      if (Array.isArray(list)) out.push(...list);
    }
    return out;
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

function countForProject(items, projectId) {
  return items.filter((it) => it && it.project_id === projectId).length;
}

export const GET = withAuth(async (req) => {
  const url = new URL(req.url);
  const projectId = url.searchParams.get('project_id');
  if (!projectId) {
    return NextResponse.json({ detail: 'Missing project_id', detail_key: 'errors.invalid_body' }, { status: 400 });
  }

  const [groups, notes, flows, prompts, sessions] = await Promise.all([
    readArray('data/groups.json', 'groups'),
    readArray('data/notes.json', 'notes'),
    readArray('data/flows.json', 'flows'),
    readArray('data/prompts.json', 'prompts'),
    readSessions(),
  ]);

  return NextResponse.json({
    groups: countForProject(groups, projectId),
    terminals: countForProject(sessions, projectId),
    notes: countForProject(notes, projectId),
    flows: countForProject(flows, projectId),
    prompts: countForProject(prompts, projectId),
  });
});
