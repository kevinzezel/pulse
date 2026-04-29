// Plan 4 (manifest-as-truth): per-install UX preferences that don't belong
// in any backend's manifest. The active project is intrinsically per-tab
// state and the default project is per-install -- two collaborators on the
// same backend each pick their own default.
//
// File: <PULSE_FRONTEND_ROOT>/data/project-prefs.json. Always lives on the
// `local` backend regardless of which backend hosts the projects themselves.

import { readLocalStore, writeLocalStore, withLocalStoreLock } from './projectStorage.js';

const REL = 'data/project-prefs.json';
const EMPTY = Object.freeze({ active_project_id: null, default_project_id: null });

function normalize(raw) {
  return {
    active_project_id: typeof raw?.active_project_id === 'string' && raw.active_project_id
      ? raw.active_project_id
      : null,
    default_project_id: typeof raw?.default_project_id === 'string' && raw.default_project_id
      ? raw.default_project_id
      : null,
  };
}

export async function readProjectPrefs() {
  const data = await readLocalStore(REL, EMPTY);
  return normalize(data);
}

export async function setActiveProjectPref(projectId) {
  await withLocalStoreLock(REL, async () => {
    const cur = normalize(await readLocalStore(REL, EMPTY));
    await writeLocalStore(REL, { ...cur, active_project_id: projectId || null });
  });
}

export async function setDefaultProjectPref(projectId) {
  await withLocalStoreLock(REL, async () => {
    const cur = normalize(await readLocalStore(REL, EMPTY));
    await writeLocalStore(REL, { ...cur, default_project_id: projectId || null });
  });
}
