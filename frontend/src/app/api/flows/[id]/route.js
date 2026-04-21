import { NextResponse } from 'next/server';
import { readJsonFile, writeJsonFileAtomic, withFileLock } from '@/lib/jsonStore';
import { withAuth } from '@/lib/auth';
import { NAME_MAX } from '@/lib/flowsConfig';

const REL = 'data/flows.json';
const EMPTY = { flows: [], updated_at: null };

function bad(detailKey, detail, status = 400, detailParams) {
  return NextResponse.json(
    { detail, detail_key: detailKey, detail_params: detailParams },
    { status }
  );
}

function isObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

async function applyPatch(flow, patch) {
  const out = { ...flow };
  if (patch.name !== undefined) {
    if (typeof patch.name !== 'string') {
      throw Object.assign(new Error('Invalid name'), { key: 'errors.invalid_body' });
    }
    const trimmed = patch.name.trim();
    if (!trimmed) {
      throw Object.assign(new Error('Flow name is required'), { key: 'errors.flow_name_required' });
    }
    if (trimmed.length > NAME_MAX) {
      throw Object.assign(new Error('Flow name too long'), {
        key: 'errors.flow_name_too_long',
        params: { max: NAME_MAX },
      });
    }
    out.name = trimmed;
  }
  if (patch.scene !== undefined) {
    if (!isObject(patch.scene)) {
      throw Object.assign(new Error('Invalid scene'), { key: 'errors.invalid_body' });
    }
    out.scene = patch.scene;
  }
  out.updated_at = new Date().toISOString();
  return out;
}

export const PATCH = withAuth(async (req, { params }) => {
  const { id } = await params;
  let body;
  try { body = await req.json(); } catch {
    return bad('errors.invalid_body', 'Invalid JSON');
  }

  try {
    const updated = await withFileLock(REL, async () => {
      const data = await readJsonFile(REL, EMPTY);
      const flows = Array.isArray(data?.flows) ? data.flows : [];
      const idx = flows.findIndex((f) => f.id === id);
      if (idx < 0) {
        throw Object.assign(new Error('Flow not found'), { key: 'errors.flow_not_found', status: 404 });
      }
      const next = await applyPatch(flows[idx], body);
      flows[idx] = next;
      await writeJsonFileAtomic(REL, { flows, updated_at: next.updated_at });
      return next;
    });
    return NextResponse.json(updated);
  } catch (err) {
    return bad(err.key || 'errors.invalid_body', err.message, err.status || 400, err.params);
  }
});

export const DELETE = withAuth(async (req, { params }) => {
  const { id } = await params;
  try {
    await withFileLock(REL, async () => {
      const data = await readJsonFile(REL, EMPTY);
      const flows = Array.isArray(data?.flows) ? data.flows : [];
      const idx = flows.findIndex((f) => f.id === id);
      if (idx < 0) {
        throw Object.assign(new Error('Flow not found'), { key: 'errors.flow_not_found', status: 404 });
      }
      flows.splice(idx, 1);
      await writeJsonFileAtomic(REL, { flows, updated_at: new Date().toISOString() });
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return bad(err.key || 'errors.invalid_body', err.message, err.status || 400, err.params);
  }
});
