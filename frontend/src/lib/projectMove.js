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
  // v5.0: index of task attachment metadata. The actual binaries live under
  // `attachments/<id>/<name>` and are migrated separately (see below) so the
  // copy stays streaming-friendly even for large files.
  'task-attachments.json',
];

const ATTACHMENTS_PREFIX = 'attachments';

// Legacy 4.2.x marker. We no longer write it — but old installs may still have
// one lying around, so the cleanup pass tries to delete it best-effort.
const LEGACY_MOVED_MARKER = '.moved.json';

function projectShardPath(projectId, file) {
  return `data/projects/${projectId}/${file}`;
}

// Copy every attachment binary listed in the source's index into the dest
// backend, preserving the per-attachment <id>/<name> path. Read+write happens
// one file at a time to keep memory bounded -- the index gives us the canonical
// list of paths, so we don't need to recursively list the source.
//
// Failure semantics (v5.0): any missing binary or copy error throws BEFORE
// the manifest cutover. The caller (moveProjectShards) relies on this to
// guarantee that a project with even one unreadable/unwritable attachment
// stays owned by the source -- a half-copied move would surface at the dest
// as a task pointing at an attachment id whose bytes never arrived.
async function copyAttachmentBinaries(projectId, fromBackendId, toBackendId, attachmentsIndex) {
  const entries = Array.isArray(attachmentsIndex?.attachments) ? attachmentsIndex.attachments : [];
  if (entries.length === 0) return 0;

  const fromDriver = await getDriverFor(fromBackendId);
  const toDriver = await getDriverFor(toBackendId);
  if (typeof fromDriver.readBinaryFile !== 'function' || typeof toDriver.writeBinaryFileAtomic !== 'function') {
    throw new Error('Source or destination driver does not support binary files');
  }

  let copied = 0;
  for (const entry of entries) {
    if (!entry?.object_path) continue;
    const fullPath = `data/projects/${projectId}/${entry.object_path}`;
    const out = await fromDriver.readBinaryFile(fullPath);
    if (!out) {
      throw new Error(
        `attachment binary missing on source for ${entry.id} (${fullPath}); aborting move to keep source canonical`,
      );
    }
    await toDriver.writeBinaryFileAtomic(fullPath, out.buffer, { contentType: entry.mime || out.contentType });
    copied += 1;
  }
  return copied;
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
  let attachmentsIndex = null;
  // 1+2: copy shards. The attachments index is captured so step 1b can mirror
  // each binary file the index references.
  for (const file of SHARD_FILES) {
    const data = await readStoreFromBackend(fromBackendId, projectShardPath(projectId, file), null);
    if (data === null) continue;
    await writeStoreToBackend(toBackendId, projectShardPath(projectId, file), data);
    copied += 1;
    if (file === 'task-attachments.json') attachmentsIndex = data;
  }

  // 1b: copy each attachment binary referenced by the now-mirrored index.
  // Failures are logged but don't abort the move because the manifest cutover
  // hasn't happened yet -- the source still owns the project until step 4.
  const binariesCopied = await copyAttachmentBinaries(projectId, fromBackendId, toBackendId, attachmentsIndex);
  if (binariesCopied > 0) {
    console.log(`[projectMove] copied ${binariesCopied} attachment binary file(s)`);
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

  // 5b: drop the source attachments tree in one shot. deletePrefix is
  // idempotent so a missing tree is fine. Drivers without deletePrefix get a
  // silent skip (the manifest cutover already removed the project; orphan
  // bytes won't surface in the UI, just consume bucket space).
  if (typeof driver.deletePrefix === 'function') {
    try {
      await driver.deletePrefix(projectShardPath(projectId, ATTACHMENTS_PREFIX));
    } catch (err) {
      console.warn(`[projectMove] failed to delete source attachments tree: ${err?.message || err}`);
    }
  }

  return { copied };
}
