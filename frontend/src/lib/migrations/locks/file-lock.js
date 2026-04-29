// File driver = single Node.js process. Migration is in-process by definition.
// No cross-machine coordination needed -- return immediately.

export async function acquireMigrationLock(driver, name, ownerId) {
  return true;
}

export async function releaseMigrationLock(driver, name, ownerId) {
  // No-op
}

export async function heartbeat(driver, name, ownerId) {
  return true;
}
