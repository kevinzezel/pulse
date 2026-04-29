import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { _readScoped, _writeScoped, _withScopedLock, _getScope } from '../route.js';

function bad(detailKey, detail, status = 400, params) {
  const body = { detail, detail_key: detailKey };
  if (params) body.detail_params = params;
  return NextResponse.json(body, { status });
}

export const PATCH = withAuth(async (req, { params }) => {
  const { id } = await params;
  const sc = _getScope(req);
  if (sc.kind === 'invalid') {
    return bad('errors.invalid_body', 'project_id or scope=global required');
  }
  let patch;
  try { patch = await req.json(); } catch { return bad('errors.invalid_body', 'Invalid JSON'); }
  if (!patch || typeof patch !== 'object') {
    return bad('errors.invalid_body', 'Expected object body');
  }

  let updated = null;
  await _withScopedLock(sc, async () => {
    const data = await _readScoped(sc);
    const groups = Array.isArray(data?.groups) ? data.groups : [];
    const idx = groups.findIndex((g) => g && g.id === id);
    if (idx < 0) return;
    const now = new Date().toISOString();
    groups[idx] = {
      ...groups[idx],
      ...patch,
      id,
      project_id: sc.kind === 'global' ? null : sc.projectId,
      updated_at: now,
    };
    updated = groups[idx];
    await _writeScoped(sc, { groups });
  });

  if (!updated) return bad('errors.prompt_group_not_found', 'prompt group not found', 404, { id });
  return NextResponse.json(updated);
});

export const DELETE = withAuth(async (req, { params }) => {
  const { id } = await params;
  const sc = _getScope(req);
  if (sc.kind === 'invalid') {
    return bad('errors.invalid_body', 'project_id or scope=global required');
  }

  let removed = false;
  await _withScopedLock(sc, async () => {
    const data = await _readScoped(sc);
    const groups = Array.isArray(data?.groups) ? data.groups : [];
    const next = groups.filter((g) => !(g && g.id === id));
    if (next.length === groups.length) return;
    removed = true;
    await _writeScoped(sc, { groups: next });
  });

  if (!removed) return bad('errors.prompt_group_not_found', 'prompt group not found', 404, { id });
  return NextResponse.json({ id });
});
