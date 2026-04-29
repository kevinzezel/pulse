import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import {
  _readProjectGroups,
  _writeProjectGroups,
  _withProjectGroupsLock,
  _getProjectId,
} from '../route.js';

function bad(detailKey, detail, status = 400, params) {
  const body = { detail, detail_key: detailKey };
  if (params) body.detail_params = params;
  return NextResponse.json(body, { status });
}

export const PATCH = withAuth(async (req, { params }) => {
  const { id } = await params;
  const projectId = _getProjectId(req);
  if (!projectId) {
    return bad('errors.invalid_body', 'project_id required');
  }
  let patch;
  try { patch = await req.json(); } catch { return bad('errors.invalid_body', 'Invalid JSON'); }
  if (!patch || typeof patch !== 'object') {
    return bad('errors.invalid_body', 'Expected object body');
  }

  let updated = null;
  await _withProjectGroupsLock(projectId, async () => {
    const data = await _readProjectGroups(projectId);
    const groups = Array.isArray(data?.groups) ? data.groups : [];
    const idx = groups.findIndex((g) => g && g.id === id);
    if (idx < 0) return;
    const now = new Date().toISOString();
    groups[idx] = {
      ...groups[idx],
      ...patch,
      id,
      project_id: projectId,
      updated_at: now,
    };
    updated = groups[idx];
    await _writeProjectGroups(projectId, { groups });
  });

  if (!updated) return bad('errors.prompt_group_not_found', 'prompt group not found', 404, { id });
  return NextResponse.json(updated);
});

export const DELETE = withAuth(async (req, { params }) => {
  const { id } = await params;
  const projectId = _getProjectId(req);
  if (!projectId) {
    return bad('errors.invalid_body', 'project_id required');
  }

  let removed = false;
  await _withProjectGroupsLock(projectId, async () => {
    const data = await _readProjectGroups(projectId);
    const groups = Array.isArray(data?.groups) ? data.groups : [];
    const next = groups.filter((g) => !(g && g.id === id));
    if (next.length === groups.length) return;
    removed = true;
    await _writeProjectGroups(projectId, { groups: next });
  });

  if (!removed) return bad('errors.prompt_group_not_found', 'prompt group not found', 404, { id });
  return NextResponse.json({ id });
});
