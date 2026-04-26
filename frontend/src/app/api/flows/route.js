import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { readStore, writeStore, withStoreLock } from '@/lib/storage';
import { withAuth } from '@/lib/auth';
import { NAME_MAX } from '@/lib/flowsConfig';
import { DEFAULT_PROJECT_ID, migrateList } from '@/lib/projectScope';

const REL = 'data/flows.json';
const EMPTY = { flows: [], updated_at: null };

async function readAndMigrate() {
  const data = await readStore(REL, EMPTY);
  const list = Array.isArray(data?.flows) ? data.flows : [];
  const { list: migrated, changed } = migrateList(list);
  if (changed) {
    await writeStore(REL, { flows: migrated, updated_at: data?.updated_at ?? new Date().toISOString() });
  }
  return { flows: migrated, updated_at: data?.updated_at ?? null };
}

function bad(detailKey, detail, status = 400, detailParams) {
  return NextResponse.json(
    { detail, detail_key: detailKey, detail_params: detailParams },
    { status }
  );
}

function isObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export const GET = withAuth(async () => {
  const data = await readAndMigrate();
  return NextResponse.json(data);
});

export const POST = withAuth(async (req) => {
  let body;
  try { body = await req.json(); } catch {
    return bad('errors.invalid_body', 'Invalid JSON');
  }

  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name) return bad('errors.flow_name_required', 'Flow name is required');
  if (name.length > NAME_MAX) {
    return bad(
      'errors.flow_name_too_long',
      `Flow name must be at most ${NAME_MAX} characters`,
      400,
      { max: NAME_MAX }
    );
  }

  const scene = isObject(body?.scene) ? body.scene : { elements: [], appState: {}, files: {} };
  const projectId = (typeof body?.project_id === 'string' && body.project_id) ? body.project_id : DEFAULT_PROJECT_ID;
  const groupId = (typeof body?.group_id === 'string' && body.group_id) ? body.group_id : null;

  const flow = await withStoreLock(REL, async () => {
    const now = new Date().toISOString();
    const data = await readAndMigrate();
    const flows = data.flows;
    const created = {
      id: `flow-${randomUUID()}`,
      name,
      scene,
      created_at: now,
      updated_at: now,
      project_id: projectId,
      group_id: groupId,
    };
    flows.push(created);
    await writeStore(REL, { flows, updated_at: now });
    return created;
  });

  return NextResponse.json(flow, { status: 201 });
});
