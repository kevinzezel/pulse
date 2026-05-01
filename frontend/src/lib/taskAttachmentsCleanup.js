// Pure helpers for the task editor modal. Lives in its own file so the
// browser bundle (TaskEditorModal -> here) doesn't transitively pull in
// projectStorage / storage / jsonStore, which use Node-only `fs`.

// Decide whether the editor should run the orphan-cleanup pass on close.
// When `submitted` is true, NO deletion happens (the user just saved, the
// attachments are now part of the task). When false, every id in `ids` is
// sent to `deleteFn` -- failures are swallowed because this is best-effort
// orphan cleanup; a follow-up project-delete sweeps anything that survived.
export async function cleanupOrphanUploads({ submitted, ids, deleteFn }) {
  if (submitted) return { deleted: 0, skipped: ids.length };
  let deleted = 0;
  for (const id of ids) {
    try {
      await deleteFn(id);
      deleted += 1;
    } catch {
      // Best-effort. The id stays in the project's index until project-delete.
    }
  }
  return { deleted, skipped: 0 };
}

// Race resolution for an upload that completed AFTER the user removed the
// row from the editor list. AbortController can't always win -- the server
// may commit the bytes before the abort signal lands. When that happens,
// the success branch of `handleUpload` calls this so the just-uploaded
// attachment gets torn down server-side.
//
// Returns:
//   - 'cancelled' when `tempId` was in `cancelledIds` (and `deleteFn` was
//     called for `uploadedId`)
//   - 'committed' when the upload should be kept (the row is still on screen)
//
// The function mutates `cancelledIds` (deletes the entry on cancellation
// resolution) so a second cancel for the same tempId is a no-op.
export async function resolveInFlightUpload({ tempId, uploadedId, cancelledIds, deleteFn }) {
  if (!cancelledIds || !cancelledIds.has(tempId)) return 'committed';
  cancelledIds.delete(tempId);
  try {
    await deleteFn(uploadedId);
  } catch {
    // Best-effort. project-delete cleans any leftover.
  }
  return 'cancelled';
}

// Close/cancel helper for active uploads. Mark every temp id as cancelled
// BEFORE aborting so a POST that already committed and later resolves with 201
// is handled by resolveInFlightUpload() as an orphan to delete, not as a
// committed attachment.
export function cancelInFlightUploads({ controllers, cancelledIds }) {
  const ids = [];
  if (!controllers || typeof controllers.entries !== 'function') return ids;
  for (const [tempId, controller] of controllers.entries()) {
    ids.push(tempId);
    if (cancelledIds && typeof cancelledIds.add === 'function') {
      cancelledIds.add(tempId);
    }
    try { controller?.abort?.(); } catch {
      // Best-effort. The fetch will either abort or resolve and be cleaned by
      // resolveInFlightUpload().
    }
  }
  if (typeof controllers.clear === 'function') controllers.clear();
  return ids;
}

// Given already-valid upload candidates, keep only the files that fit in the
// remaining per-task attachment slots. Invalid files should be filtered before
// this helper so they do not consume slots.
export function splitUploadCandidatesByAvailableSlots(candidates, usedCount, maxCount) {
  const list = Array.isArray(candidates) ? candidates : [];
  const used = Number.isFinite(usedCount) ? Math.max(0, usedCount) : 0;
  const max = Number.isFinite(maxCount) ? Math.max(0, maxCount) : 0;
  const available = Math.max(0, max - used);
  const accepted = list.slice(0, available);
  return {
    accepted,
    rejectedCount: Math.max(0, list.length - accepted.length),
  };
}

// Remove one id from the "uploaded during this modal session" list and tell
// the caller whether it was there. A removed session upload can be deleted
// immediately even while editing an existing task because it was never part of
// the saved task payload before this modal opened.
export function consumeSessionUploadId(uploadIds, attachmentId) {
  const ids = Array.isArray(uploadIds) ? uploadIds : [];
  const nextIds = ids.filter((id) => id !== attachmentId);
  return {
    nextIds,
    consumed: nextIds.length !== ids.length,
  };
}
