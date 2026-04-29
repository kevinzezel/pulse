import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { withAuth } from '@/lib/auth';
import {
  readProjectFile,
  writeProjectFile,
  withProjectLock,
  readGlobalFile,
  writeGlobalFile,
  withGlobalLock,
} from '@/lib/projectStorage';

const FILE = 'prompts.json';
const EMPTY = { prompts: [] };

function bad(detailKey, detail, status = 400, params) {
  const body = { detail, detail_key: detailKey };
  if (params) body.detail_params = params;
  return NextResponse.json(body, { status });
}

// Returns { kind: 'global' } | { kind: 'project', projectId } | { kind: 'invalid' }.
// Rejects literal "null" string for project_id (must use ?scope=global instead).
function getScope(req) {
  const url = new URL(req.url);
  const projectId = url.searchParams.get('project_id');
  const scope = url.searchParams.get('scope');
  if (scope === 'global') return { kind: 'global' };
  if (typeof projectId === 'string' && projectId && projectId !== 'null') {
    return { kind: 'project', projectId };
  }
  return { kind: 'invalid' };
}

async function readScoped(sc) {
  if (sc.kind === 'global') return await readGlobalFile(FILE, EMPTY);
  return await readProjectFile(sc.projectId, FILE, EMPTY);
}

async function writeScoped(sc, data) {
  if (sc.kind === 'global') return await writeGlobalFile(FILE, data);
  return await writeProjectFile(sc.projectId, FILE, data);
}

async function withScopedLock(sc, fn) {
  if (sc.kind === 'global') return await withGlobalLock(FILE, fn);
  return await withProjectLock(sc.projectId, FILE, fn);
}

export const GET = withAuth(async (req) => {
  const sc = getScope(req);
  if (sc.kind === 'invalid') {
    return bad('errors.invalid_body', 'project_id query param or scope=global is required', 400);
  }
  try {
    const data = await readScoped(sc);
    return NextResponse.json({ prompts: Array.isArray(data?.prompts) ? data.prompts : [] });
  } catch (err) {
    if (/unknown project/i.test(err?.message || '')) {
      return bad('errors.project_not_found', 'project not found', 404, { project_id: sc.projectId });
    }
    throw err;
  }
});

export const POST = withAuth(async (req) => {
  const sc = getScope(req);
  if (sc.kind === 'invalid') {
    return bad('errors.invalid_body', 'project_id query param or scope=global is required', 400);
  }
  let body;
  try { body = await req.json(); } catch { return bad('errors.invalid_body', 'Invalid JSON'); }
  if (!body || typeof body !== 'object') {
    return bad('errors.invalid_body', 'Expected object body');
  }

  const created = await withScopedLock(sc, async () => {
    const data = await readScoped(sc);
    const prompts = Array.isArray(data?.prompts) ? data.prompts : [];
    const now = new Date().toISOString();
    const prompt = {
      id: `pid-${randomUUID()}`,
      name: typeof body.name === 'string' ? body.name : '',
      body: typeof body.body === 'string' ? body.body : '',
      pinned: !!body.pinned,
      group_id: typeof body.group_id === 'string' ? body.group_id : null,
      project_id: sc.kind === 'global' ? null : sc.projectId,
      created_at: now,
      updated_at: now,
    };
    prompts.push(prompt);
    await writeScoped(sc, { prompts });
    return prompt;
  });

  return NextResponse.json(created, { status: 201 });
});

// PUT replace: kept for reorder (drag-drop). Last-writer-wins.
export const PUT = withAuth(async (req) => {
  const sc = getScope(req);
  if (sc.kind === 'invalid') {
    return bad('errors.invalid_body', 'project_id query param or scope=global is required', 400);
  }
  let body;
  try { body = await req.json(); } catch { return bad('errors.invalid_body', 'Invalid JSON'); }
  if (!body || !Array.isArray(body.prompts)) {
    return bad('errors.invalid_body', 'Expected { prompts: [...] }');
  }
  await withScopedLock(sc, async () => {
    await writeScoped(sc, { prompts: body.prompts });
  });
  return NextResponse.json({ prompts: body.prompts });
});

// Helpers exported for [id]/route.js — Next.js only treats GET/POST/PUT/PATCH/DELETE
// as HTTP method handlers; named-export helpers like these are ignored by the
// route scanner.
export { getScope as _getScope, readScoped as _readScoped, writeScoped as _writeScoped, withScopedLock as _withScopedLock };
