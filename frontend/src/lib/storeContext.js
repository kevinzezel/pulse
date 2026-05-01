import { AsyncLocalStorage } from 'async_hooks';

// Shared context used by s3Store to carry optimistic-lock metadata from a
// readJsonFile call through the enclosing withFileLock boundary into the
// nested writeJsonFileAtomic call. Without this, the writer would have no
// way to know "what etag did I just see" that must match for the write to
// be race-free.
//
// `etagByKey[key]` = string ETag header captured on read; the matching
// writeJsonFileAtomic uses it as IfMatch so concurrent writers from another
// install lose the race deterministically.
//
// A fresh context object is created per retry attempt so a retried mutator
// re-captures the current state instead of reusing the stale snapshot that
// caused the conflict.
export const _versionContext = new AsyncLocalStorage();

export function newContext() {
  return { etagByKey: {} };
}
