import {
  readStoreFromBackend,
  writeStoreToBackend,
  withStoreLockOnBackend,
  getDriverFor,
} from './storage.js';

const SHARD_FILES = [
  'flows.json',
  'flow-groups.json',
  'notes.json',
  'prompts.json',
  'prompt-groups.json',
  'task-boards.json',
  'task-board-groups.json',
];

function projectShardPath(projectId, file) {
  return `data/projects/${projectId}/${file}`;
}

function projectMarkerPath(projectId) {
  return `data/projects/${projectId}/.moved.json`;
}

const MANIFEST_REL = 'projects-manifest.json';

// Move a project's shards from `fromBackendId` to `toBackendId`. Order:
// 1. Read each shard from source.
// 2. Write to dest (idempotent — partial run can be retried).
// 3. Update dest manifest (add project entry).
// 4. Write `.moved.json` redirect marker on source.
// 5. Update source manifest (remove project entry).
// 6. Best-effort delete source shards (the marker stays — other installs can
//    detect it and prompt for the new backend's token).
//
// Steps 3-5 are the cutover; once they're committed, dest owns the project.
// Step 6 failures don't roll back — the project is on dest, the marker on
// source guides the cleanup, and a future operation can finish.
export async function moveProjectShards(projectId, fromBackendId, toBackendId, opts = {}) {
  if (fromBackendId === toBackendId) {
    return { copied: 0, skipped: SHARD_FILES.length };
  }

  let copied = 0;
  // 1+2: copy shards
  for (const file of SHARD_FILES) {
    const data = await readStoreFromBackend(fromBackendId, projectShardPath(projectId, file), null);
    if (data === null) continue;
    await writeStoreToBackend(toBackendId, projectShardPath(projectId, file), data);
    copied += 1;
  }

  // 3: dest manifest add
  await withStoreLockOnBackend(toBackendId, MANIFEST_REL, async () => {
    const manifest = await readStoreFromBackend(toBackendId, MANIFEST_REL, { v: 1, projects: [] });
    const projects = Array.isArray(manifest.projects) ? manifest.projects : [];
    if (!projects.some((p) => p.id === projectId)) {
      projects.push({
        id: projectId,
        name: opts.name || projectId,
        created_at: opts.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      await writeStoreToBackend(toBackendId, MANIFEST_REL, { v: 1, projects });
    }
  });

  // 4: write redirect marker on source BEFORE removing manifest entry — other
  // installs that lose the manifest entry but find the marker know where to
  // look for the new token.
  await writeStoreToBackend(fromBackendId, projectMarkerPath(projectId), {
    v: 1,
    project_id: projectId,
    moved_to_backend_id: toBackendId,
    moved_to_backend_name: opts.toBackendName || toBackendId,
    moved_at: new Date().toISOString(),
    note: 'This project was moved to a different backend. Import the new token to continue accessing it.',
  });

  // 5: source manifest remove
  await withStoreLockOnBackend(fromBackendId, MANIFEST_REL, async () => {
    const manifest = await readStoreFromBackend(fromBackendId, MANIFEST_REL, { v: 1, projects: [] });
    const projects = Array.isArray(manifest.projects) ? manifest.projects : [];
    const next = projects.filter((p) => p.id !== projectId);
    if (next.length !== projects.length) {
      await writeStoreToBackend(fromBackendId, MANIFEST_REL, { v: 1, projects: next });
    }
  });

  // 6: best-effort delete of source shards (NOT the marker)
  for (const file of SHARD_FILES) {
    try {
      const driver = await getDriverFor(fromBackendId);
      if (typeof driver.deleteFile === 'function') {
        await driver.deleteFile(projectShardPath(projectId, file));
      }
    } catch (err) {
      console.warn(`[projectMove] failed to delete source shard ${file}: ${err?.message || err}`);
    }
  }

  return { copied };
}
