import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { getConfig } from '@/lib/storage';
import { readLocalStore, writeLocalStore, withLocalStoreLock } from '@/lib/projectStorage';

function bad(detailKey, detail, status = 400, params) {
  const body = { detail, detail_key: detailKey };
  if (params) body.detail_params = params;
  return NextResponse.json(body, { status });
}

const REL = 'data/projects.json';
const EMPTY = { projects: [], active_project_id: null };

export const POST = withAuth(async (req) => {
  let body;
  try { body = await req.json(); } catch { return bad('errors.invalid_body', 'Invalid JSON'); }
  if (typeof body?.backend_id !== 'string' || !body.backend_id) {
    return bad('errors.invalid_body', 'backend_id is required');
  }
  if (!Array.isArray(body?.projects) || body.projects.length === 0) {
    return bad('errors.invalid_body', 'projects array is required');
  }

  // Verify the target backend actually exists. Without this, a buggy or
  // malicious caller could leave projects pointing at a dangling storage_ref.
  const cfg = await getConfig();
  if (!cfg.backends.some((b) => b.id === body.backend_id)) {
    return bad('errors.backend_unknown', 'Target backend not found', 404, { id: body.backend_id });
  }

  let added = 0;
  let skipped = 0;

  await withLocalStoreLock(REL, async () => {
    const doc = await readLocalStore(REL, EMPTY);
    const projects = Array.isArray(doc?.projects) ? doc.projects : [];
    const knownIds = new Set(projects.map((p) => p.id));

    for (const incoming of body.projects) {
      if (!incoming || typeof incoming.id !== 'string' || !incoming.id) {
        skipped += 1;
        continue;
      }
      if (knownIds.has(incoming.id)) {
        skipped += 1;
        continue;
      }
      projects.push({
        id: incoming.id,
        name: typeof incoming.name === 'string' ? incoming.name : incoming.id,
        is_default: false,
        created_at: incoming.created_at || new Date().toISOString(),
        storage_ref: body.backend_id,
      });
      knownIds.add(incoming.id);
      added += 1;
    }

    await writeLocalStore(REL, { ...doc, projects });
  });

  return NextResponse.json({ added, skipped });
});
