import {
  readStoreFromBackend,
  writeStoreToBackend,
  getDriverFor,
} from './storage.js';
import { addProjectToManifest, removeProjectFromManifest } from './projectIndex.js';

const SHARD_FILES = [
  'flows.json',
  'flow-groups.json',
  'notes.json',
  'prompts.json',
  'prompt-groups.json',
  'task-boards.json',
  'task-board-groups.json',
];

// Legacy 4.2.x marker. We no longer write it — but old installs may still have
// one lying around, so the cleanup pass tries to delete it best-effort.
const LEGACY_MOVED_MARKER = '.moved.json';

function projectShardPath(projectId, file) {
  return `data/projects/${projectId}/${file}`;
}

// Move a project's shards from `fromBackendId` to `toBackendId`. After this
// returns successfully, exactly one manifest entry remains: on the dest. Order:
// 1. Read each shard from source.
// 2. Write to dest (idempotent — partial run can be retried).
// 3. Add the project to the dest manifest (canonical `data/projects-manifest.json`).
// 4. Remove the project from the source manifest.
// 5. Best-effort delete source shards + any legacy `.moved.json` marker.
//
// Steps 3-4 are the cutover; once they're committed, dest owns the project.
// Step 5 failures don't roll back — the project is already on dest, the source
// manifest no longer lists it, so listAllProjects() reports a single entry on
// the destination regardless of leftover shard files.
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

  // 3: dest manifest add (uses the canonical helper — same path the rest of
  // the app reads from, so listAllProjects sees the entry immediately).
  await addProjectToManifest(toBackendId, {
    id: projectId,
    name: opts.name,
    created_at: opts.created_at,
  });

  // 4: source manifest remove
  await removeProjectFromManifest(fromBackendId, projectId);

  // 5: best-effort delete of source shards + legacy `.moved.json` marker that
  // older installs may have written. Failures are logged but do not roll back
  // the manifest changes above — the cutover is the source of truth.
  const driver = await getDriverFor(fromBackendId);
  if (typeof driver.deleteFile === 'function') {
    for (const file of SHARD_FILES) {
      try {
        await driver.deleteFile(projectShardPath(projectId, file));
      } catch (err) {
        console.warn(`[projectMove] failed to delete source shard ${file}: ${err?.message || err}`);
      }
    }
    try {
      await driver.deleteFile(projectShardPath(projectId, LEGACY_MOVED_MARKER));
    } catch (err) {
      console.warn(`[projectMove] failed to delete legacy ${LEGACY_MOVED_MARKER}: ${err?.message || err}`);
    }
  }

  return { copied };
}
