import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { withAuth } from '@/lib/auth';
import { listAllProjects, addProjectToManifest } from '@/lib/projectIndex';
import {
  readProjectPrefs,
  setActiveProjectPref,
  setDefaultProjectPref,
} from '@/lib/projectPrefs';
import { getConfig } from '@/lib/storage';

const NAME_MAX = 64;

function bad(detailKey, detail, status = 400, params) {
  const body = { detail, detail_key: detailKey };
  if (params) body.detail_params = params;
  return NextResponse.json(body, { status });
}

// GET /api/projects: aggregate every backend's `projects-manifest.json`
// into a single project list, decorate each entry with the owning
// `storage_ref` (= backend id), and merge in per-install prefs to expose
// `is_default` / `active_project_id`. The shape is back-compat with the
// pre-v4.2 contract (`{ projects, active_project_id }`) so the frontend
// provider keeps working without changes; the addition of `storage_ref`
// per entry is purely additive.
export const GET = withAuth(async () => {
  const all = await listAllProjects();
  const prefs = await readProjectPrefs();

  const projects = all.map((p) => ({
    id: p.id,
    name: p.name,
    storage_ref: p.backend_id,
    created_at: p.created_at,
    updated_at: p.updated_at,
    is_default: p.id === prefs.default_project_id,
  }));

  // active_project_id resolution: fall back to default, then first project.
  const knownIds = new Set(projects.map((p) => p.id));
  let activeId = prefs.active_project_id;
  if (!activeId || !knownIds.has(activeId)) {
    if (prefs.default_project_id && knownIds.has(prefs.default_project_id)) {
      activeId = prefs.default_project_id;
    } else {
      activeId = projects[0]?.id || null;
    }
  }

  return NextResponse.json({ projects, active_project_id: activeId });
});

// POST /api/projects: create a new project on the chosen backend.
// `target_backend_id` is required (no implicit "default backend" guesswork
// to avoid orphan projects when the default flips). Validation rejects
// missing/oversized names and unknown backend ids.
export const POST = withAuth(async (req) => {
  let body;
  try { body = await req.json(); } catch { return bad('errors.invalid_body', 'Invalid JSON'); }

  const name = String(body?.name ?? '').trim();
  if (!name || name.length > NAME_MAX) {
    return bad('errors.invalid_body', `name is required and must be at most ${NAME_MAX} chars`);
  }

  const targetBackendId = (typeof body?.target_backend_id === 'string' && body.target_backend_id)
    ? body.target_backend_id
    : 'local';

  // Reject unknown backend ids up front -- otherwise the manifest write
  // would fail with a less-friendly error from the driver layer.
  const cfg = await getConfig();
  if (!cfg.backends.find((b) => b.id === targetBackendId)) {
    return bad('errors.backend_unknown', 'Target backend not found', 404, { id: targetBackendId });
  }

  const id = `proj-${randomUUID()}`;
  const created_at = new Date().toISOString();

  await addProjectToManifest(targetBackendId, { id, name, created_at });

  // First-project ergonomics: when there's no default/active pref yet
  // (fresh install or post-onboarding), claim the new project as both. The
  // OnboardingGate dismisses on `projects.length > 0`, so without this the
  // user lands on the dashboard with `active_project_id: null` in the
  // server-side prefs and has to manually click "Set as default" to make
  // the badge match what the UI is already showing them.
  const prefs = await readProjectPrefs();
  let isDefault = false;
  if (!prefs.default_project_id) {
    await setDefaultProjectPref(id);
    isDefault = true;
  }
  if (!prefs.active_project_id) {
    await setActiveProjectPref(id);
  }

  return NextResponse.json({
    id,
    name,
    storage_ref: targetBackendId,
    created_at,
    updated_at: created_at,
    is_default: isDefault,
  }, { status: 201 });
});

// PUT /api/projects: per-install pref to track which project is active for
// this dashboard tab. Body: `{ active_project_id }`. Returns the new value.
// Note: Plan 4 dropped the bulk-overwrite contract that the v4.1 PUT used --
// callers that want to rename / set-default should hit `/api/projects/[id]`
// instead.
export const PUT = withAuth(async (req) => {
  let body;
  try { body = await req.json(); } catch { return bad('errors.invalid_body', 'Invalid JSON'); }

  if (typeof body?.active_project_id !== 'string' || !body.active_project_id) {
    return bad('errors.invalid_body', 'active_project_id is required');
  }

  await setActiveProjectPref(body.active_project_id);
  return NextResponse.json({ active_project_id: body.active_project_id });
});
