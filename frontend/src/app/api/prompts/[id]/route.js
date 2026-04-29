import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import {
  _readScoped,
  _writeScoped,
  _withScopedLock,
  _getScope,
  _normalizeGroupId,
  _validatePromptGroupForScope,
} from '../route.js';

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
  if (Object.prototype.hasOwnProperty.call(patch, 'group_id')) {
    const groupId = _normalizeGroupId(patch.group_id);
    const groupErr = await _validatePromptGroupForScope(sc, groupId);
    if (groupErr) return bad(groupErr.detailKey, groupErr.detail, 400, groupErr.params);
  }

  let updated = null;
  await _withScopedLock(sc, async () => {
    const data = await _readScoped(sc);
    const prompts = Array.isArray(data?.prompts) ? data.prompts : [];
    const idx = prompts.findIndex((p) => p && p.id === id);
    if (idx < 0) return;
    const now = new Date().toISOString();
    const hasGroupPatch = Object.prototype.hasOwnProperty.call(patch, 'group_id');
    const nextGroupId = hasGroupPatch ? _normalizeGroupId(patch.group_id) : _normalizeGroupId(prompts[idx].group_id);
    prompts[idx] = {
      ...prompts[idx],
      ...patch,
      id,
      project_id: sc.kind === 'global' ? null : sc.projectId,
      group_id: sc.kind === 'global' ? null : nextGroupId,
      updated_at: now,
    };
    updated = prompts[idx];
    await _writeScoped(sc, { prompts });
  });

  if (!updated) return bad('errors.prompt_not_found', 'prompt not found', 404, { id });
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
    const prompts = Array.isArray(data?.prompts) ? data.prompts : [];
    const next = prompts.filter((p) => !(p && p.id === id));
    if (next.length === prompts.length) return;
    removed = true;
    await _writeScoped(sc, { prompts: next });
  });

  if (!removed) return bad('errors.prompt_not_found', 'prompt not found', 404, { id });
  return NextResponse.json({ id });
});
