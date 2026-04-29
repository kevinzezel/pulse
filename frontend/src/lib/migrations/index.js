import { migrate as migrateV3ToV4 } from './v3-to-v4.js';

let _migrationPromise = null;

// Run pending schema migrations once per process. Subsequent calls return
// the same Promise -- fully idempotent. Called from storage.js getConfig()
// on the first read so callers don't need a manual init step.
export async function ensureMigrationsApplied() {
  if (_migrationPromise) return _migrationPromise;
  const promise = (async () => {
    const result = await migrateV3ToV4();
    if (result?.ran) {
      console.log(`[migrations] Applied v3 -> v4 (case ${result.case})`);
    }
    return result;
  })();
  _migrationPromise = promise;
  // Fail-soft: a failed migration must not permanently brick this process.
  // Mirrors the self-evicting pattern used by getDriverFor in storage.js.
  promise.catch(() => {
    if (_migrationPromise === promise) _migrationPromise = null;
  });
  return promise;
}

// Test-only: clear the cached promise so the next call re-runs migrations.
export function _resetMigrationsForTests() {
  _migrationPromise = null;
}
