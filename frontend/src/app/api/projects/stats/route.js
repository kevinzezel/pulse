import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { readStore } from '@/lib/storage';

async function readArray(relPath, key) {
  const data = await readStore(relPath, null);
  return Array.isArray(data?.[key]) ? data[key] : [];
}

async function readSessions() {
  const data = await readStore('data/sessions.json', null);
  if (!data || typeof data.servers !== 'object') return [];
  const out = [];
  for (const list of Object.values(data.servers)) {
    if (Array.isArray(list)) out.push(...list);
  }
  return out;
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

  const [groups, flowGroups, notes, flows, prompts, sessions] = await Promise.all([
    readArray('data/groups.json', 'groups'),
    readArray('data/flow-groups.json', 'groups'),
    readArray('data/notes.json', 'notes'),
    readArray('data/flows.json', 'flows'),
    readArray('data/prompts.json', 'prompts'),
    readSessions(),
  ]);

  return NextResponse.json({
    groups: countForProject(groups, projectId) + countForProject(flowGroups, projectId),
    terminals: countForProject(sessions, projectId),
    notes: countForProject(notes, projectId),
    flows: countForProject(flows, projectId),
    prompts: countForProject(prompts, projectId),
  });
});
