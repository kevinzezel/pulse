const HEARTBEAT_TIMEOUT_MS = 90 * 1000;
const COLLECTION = '_pulse_migrations';

function rawCollection(driver) {
  return driver.rawDb().collection(COLLECTION);
}

export async function acquireMigrationLock(driver, name, ownerId) {
  const coll = rawCollection(driver);
  const now = Date.now();
  const cutoff = now - HEARTBEAT_TIMEOUT_MS;

  // Atomic upsert: take if no doc OR existing doc is stale.
  let result;
  try {
    result = await coll.findOneAndUpdate(
      {
        _id: name,
        $or: [
          { heartbeat_at: { $lt: cutoff } },
          { heartbeat_at: { $exists: false } },
        ],
      },
      {
        $set: { owner: ownerId, started_at: now, heartbeat_at: now },
      },
      { upsert: true, returnDocument: 'after' },
    );
  } catch (err) {
    // Duplicate key error means doc exists and is fresh.
    if (err?.code === 11000) return false;
    throw err;
  }

  if (!result) return false;
  // findOneAndUpdate may return the value object or { value: ... } depending on driver version.
  const doc = result.value || result;
  return doc?.owner === ownerId;
}

export async function releaseMigrationLock(driver, name, ownerId) {
  await rawCollection(driver).deleteOne({ _id: name, owner: ownerId });
}

export async function heartbeat(driver, name, ownerId) {
  const result = await rawCollection(driver).updateOne(
    { _id: name, owner: ownerId },
    { $set: { heartbeat_at: Date.now() } },
  );
  return result.modifiedCount > 0;
}
