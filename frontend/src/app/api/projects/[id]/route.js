import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import {
  addProjectToManifest,
  removeProjectFromManifest,
  findProjectBackend,
} from '@/lib/projectIndex';
import { setDefaultProjectPref } from '@/lib/projectPrefs';
import { getDriverFor } from '@/lib/storage';

// Per-project shard files written by the data-bearing routes. Mirrors the
// list in `projectMove.js` and `migrations/v3-to-v4.js`. Kept in lock-step;
// adding a new shard to the codebase means adding it here too so DELETE
// cleans it up.
const SHARD_FILES = [
  'flows.json',
  'flow-groups.json',
  'notes.json',
  'prompts.json',
  'prompt-groups.json',
  'task-boards.json',
  'task-board-groups.json',
];

const NAME_MAX = 64;

function bad(detailKey, detail, status = 400, params) {
  const body = { detail, detail_key: detailKey };
  if (params) body.detail_params = params;
  return NextResponse.json(body, { status });
}

// PATCH /api/projects/[id]: two operations gated by body shape.
//   - `{ set_default: true }` -> per-install default pref (local file).
//   - `{ name: "..." }`       -> rename in the owning backend's manifest.
// Anything else returns 400. Both ops surface 404 when the project id can't
// be located in any backend manifest.
export const PATCH = withAuth(async (req, { params }) => {
  const { id } = await params;
  let body;
  try { body = await req.json(); } catch { return bad('errors.invalid_body', 'Invalid JSON'); }

  if (body?.set_default === true) {
    await setDefaultProjectPref(id);
    return NextResponse.json({ id, default: true });
  }

  if (typeof body?.name === 'string') {
    const name = body.name.trim();
    if (!name || name.length > NAME_MAX) {
      return bad('errors.invalid_body', `name must be 1..${NAME_MAX} chars`);
    }
    const backendId = await findProjectBackend(id);
    if (!backendId) {
      return bad('errors.project_not_found', 'project not found', 404, { project_id: id });
    }
    // addProjectToManifest is upsert: matching id -> name update.
    await addProjectToManifest(backendId, { id, name });
    return NextResponse.json({ id, name, storage_ref: backendId });
  }

  return bad('errors.invalid_body', 'Unsupported PATCH operation');
});

// DELETE /api/projects/[id]: remove from manifest + best-effort cleanup of
// per-project shard files. Shard cleanup runs after the manifest entry is
// gone, so a partial failure leaves the system in "project deleted, some
// orphan shards" -- worse than ideal but safe (no data appears in the UI).
// We swallow individual deleteFile errors because a missing shard is not an
// error condition.
export const DELETE = withAuth(async (req, { params }) => {
  const { id } = await params;
  const backendId = await findProjectBackend(id);
  if (!backendId) {
    return bad('errors.project_not_found', 'project not found', 404, { project_id: id });
  }

  await removeProjectFromManifest(backendId, id);

  // Best-effort shard cleanup. Driver may not implement deleteFile; that's
  // fine -- the manifest entry is already gone, so the shards are orphans
  // that won't appear in the UI.
  try {
    const driver = await getDriverFor(backendId);
    if (typeof driver.deleteFile === 'function') {
      for (const file of SHARD_FILES) {
        try {
          await driver.deleteFile(`data/projects/${id}/${file}`);
        } catch {
          // Single-file failure is non-fatal -- continue cleaning the rest.
        }
      }
    }
  } catch {
    // Driver init failure during cleanup is non-fatal -- the project is
    // already removed from the manifest, so the UI sees it as deleted.
  }

  return NextResponse.json({ id, removed: true });
});
