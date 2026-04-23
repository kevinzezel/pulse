import { AsyncLocalStorage } from 'async_hooks';

// Shared context used by mongoStore and s3Store to carry optimistic-lock
// metadata from a readJsonFile call through the enclosing withFileLock
// boundary into the nested writeJsonFileAtomic call. Without this, the
// writer would have no way to know "what version / etag did I just see"
// that must match for the write to be race-free.
//
// Two parallel fields — one per driver — so TypeScript / JSDoc users can
// tell at a glance which discipline each key is using:
//   - Mongo: versionByKey[key] = integer _version field
//   - S3:    etagByKey[key]    = string ETag header
//
// A fresh context object is created per retry attempt so a retried mutator
// re-captures the current state instead of reusing the stale snapshot that
// caused the conflict.
export const _versionContext = new AsyncLocalStorage();

export function newContext() {
  return { versionByKey: {}, etagByKey: {} };
}
