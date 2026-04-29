import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { withAuth } from '@/lib/auth';
import {
  readProjectFile,
  writeProjectFile,
  withProjectLock,
  validateGroupBelongsToProject,
} from '@/lib/projectStorage';

const FILE = 'flows.json';
const EMPTY = { flows: [] };

function bad(detailKey, detail, status = 400, params) {
  const body = { detail, detail_key: detailKey };
  if (params) body.detail_params = params;
  return NextResponse.json(body, { status });
}

function getProjectId(req) {
  const url = new URL(req.url);
  return url.searchParams.get('project_id');
}

export const GET = withAuth(async (req) => {
  const projectId = getProjectId(req);
  if (!projectId) {
    return bad('errors.invalid_body', 'project_id query param is required', 400);
  }
  try {
    const data = await readProjectFile(projectId, FILE, EMPTY);
    const flows = (Array.isArray(data?.flows) ? data.flows : [])
      .map((flow) => ({ ...flow, project_id: projectId }));
    return NextResponse.json({ flows });
  } catch (err) {
    if (/unknown project/i.test(err?.message || '')) {
      return bad('errors.project_not_found', 'project not found', 404, { project_id: projectId });
    }
    throw err;
  }
});

export const POST = withAuth(async (req) => {
  const projectId = getProjectId(req);
  if (!projectId) {
    return bad('errors.invalid_body', 'project_id query param is required', 400);
  }
  let body;
  try {
    body = await req.json();
  } catch {
    return bad('errors.invalid_body', 'Invalid JSON', 400);
  }
  if (!body || typeof body !== 'object') {
    return bad('errors.invalid_body', 'Expected object body', 400);
  }

  // Cross-project group leak guard: a frontend race could submit a
  // group_id that lives on a sibling project. Reject before write.
  const groupErr = await validateGroupBelongsToProject(projectId, 'flow-groups.json', body.group_id ?? null);
  if (groupErr) return bad(groupErr.detailKey, groupErr.detail, 400, groupErr.params);

  const newFlow = await withProjectLock(projectId, FILE, async () => {
    const data = await readProjectFile(projectId, FILE, EMPTY);
    const flows = Array.isArray(data?.flows) ? data.flows : [];
    const now = new Date().toISOString();
    const flow = {
      id: `flow-${randomUUID()}`,
      name: typeof body.name === 'string' ? body.name : '',
      scene: body.scene && typeof body.scene === 'object' ? body.scene : { elements: [] },
      group_id: typeof body.group_id === 'string' ? body.group_id : null,
      pinned: !!body.pinned,
      project_id: projectId,
      created_at: now,
      updated_at: now,
    };
    flows.push(flow);
    await writeProjectFile(projectId, FILE, { flows });
    return flow;
  });

  return NextResponse.json(newFlow, { status: 201 });
});

// Reorder via full replace — last-writer-wins, kept for drag-drop UX.
export const PUT = withAuth(async (req) => {
  const projectId = getProjectId(req);
  if (!projectId) {
    return bad('errors.invalid_body', 'project_id query param is required', 400);
  }
  let body;
  try {
    body = await req.json();
  } catch {
    return bad('errors.invalid_body', 'Invalid JSON', 400);
  }
  if (!body || !Array.isArray(body.flows)) {
    return bad('errors.invalid_body', 'Expected { flows: [...] }', 400);
  }
  await withProjectLock(projectId, FILE, async () => {
    await writeProjectFile(projectId, FILE, { flows: body.flows });
  });
  return NextResponse.json({ flows: body.flows });
});
