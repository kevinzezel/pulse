import { migrate as migrateV3ToV4 } from './v3-to-v4.js';
import { migrate as migrateV41ToV42 } from './v4-1-to-v4-2.js';

let _migrationPromise = null;

// Run pending schema migrations once per process. Subsequent calls return
// the same Promise -- fully idempotent. Called from storage.js getConfig()
// on the first read so callers don't need a manual init step.
export async function ensureMigrationsApplied() {
  if (_migrationPromise) return _migrationPromise;
  const promise = (async () => {
    const v4Result = await migrateV3ToV4();
    if (v4Result?.ran) {
      console.log(`[migrations] Applied v3 -> v4 (case ${v4Result.case})`);
    }
    // v4.1 -> v4.2 reconciler: pushes legacy local projects.json entries
    // into per-backend projects-manifest.json files, extracts per-install
    // prefs, and bumps the config marker to v:3. Idempotent.
    const v42Result = await migrateV41ToV42();
    if (v42Result?.ran) {
      console.log('[migrations] Applied v4.1 -> v4.2 reconciler');
    }
    return v4Result;
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
