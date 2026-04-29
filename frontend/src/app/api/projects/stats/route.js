import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { readProjectFile, readLocalStore } from '@/lib/projectStorage';

// Local (per-install) reads — terminals + their groups, plus session metadata.
// Stay on the flat layout because they reference per-install state (serverIds).
// Routed through readLocalStore so they always hit the local backend, not the
// default backend (which may be S3/Mongo for users with remote-default setups).
async function readLocalArray(relPath, key) {
  const data = await readLocalStore(relPath, null);
  return Array.isArray(data?.[key]) ? data[key] : [];
}

async function readSessions() {
  const data = await readLocalStore('data/sessions.json', null);
  if (!data || typeof data.servers !== 'object') return [];
  const out = [];
  for (const list of Object.values(data.servers)) {
    if (Array.isArray(list)) out.push(...list);
  }
  return out;
}

// Per-project read — uses the projectStorage helper which routes to the
// project's storage_ref backend (local or remote) at the sharded path.
// Returns [] when the project is unknown so missing-shard scenarios don't 500.
async function readProjectArray(projectId, file, key) {
  try {
    const data = await readProjectFile(projectId, file, null);
    return Array.isArray(data?.[key]) ? data[key] : [];
  } catch (err) {
    if (/unknown project/i.test(err?.message || '')) return [];
    throw err;
  }
}

export const GET = withAuth(async (req) => {
  const url = new URL(req.url);
  const projectId = url.searchParams.get('project_id');
  if (!projectId) {
    return NextResponse.json({ detail: 'Missing project_id', detail_key: 'errors.invalid_body' }, { status: 400 });
  }

  // Per-project shards — already scoped, no further filtering needed.
  const [flows, flowGroups, notes, prompts, taskBoards, taskBoardGroups] = await Promise.all([
    readProjectArray(projectId, 'flows.json', 'flows'),
    readProjectArray(projectId, 'flow-groups.json', 'groups'),
    readProjectArray(projectId, 'notes.json', 'notes'),
    readProjectArray(projectId, 'prompts.json', 'prompts'),
    readProjectArray(projectId, 'task-boards.json', 'boards'),
    readProjectArray(projectId, 'task-board-groups.json', 'groups'),
  ]);

  // Local-only — filter by project_id manually since these stay flat.
  const [terminalGroups, sessions] = await Promise.all([
    readLocalArray('data/groups.json', 'groups'),
    readSessions(),
  ]);

  const tasksCount = taskBoards.reduce(
    (acc, b) => acc + (Array.isArray(b.tasks) ? b.tasks.length : 0),
    0,
  );

  return NextResponse.json({
    groups: terminalGroups.filter((g) => g && g.project_id === projectId).length
      + flowGroups.length
      + taskBoardGroups.length,
    terminals: sessions.filter((s) => s && s.project_id === projectId).length,
    notes: notes.length,
    flows: flows.length,
    prompts: prompts.length,
    taskBoards: taskBoards.length,
    tasks: tasksCount,
  });
});
