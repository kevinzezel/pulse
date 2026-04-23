import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import * as fileStore from '@/lib/jsonStore';
import { readConfigAsync, getDriverModule, DATA_REL_PATHS } from '@/lib/storage';

function bad(detailKey, detail, status = 400, params) {
  const body = { detail, detail_key: detailKey };
  if (params) body.detail_params = params;
  return NextResponse.json(body, { status });
}

export const POST = withAuth(async () => {
  const config = await readConfigAsync();
  if (!config || config.driver === 'file') {
    return bad('errors.storage.not_configured', 'No remote storage is configured', 400);
  }

  let driver;
  try {
    driver = await getDriverModule(config.driver);
    await driver.init(config);
  } catch (err) {
    const key = config.driver === 'mongo' || config.driver === 's3'
      ? `errors.${config.driver}.connection_failed`
      : 'errors.storage.unavailable';
    return bad(
      key,
      `Storage connection failed: ${err?.message || err}`,
      503,
      { reason: err?.message || String(err) },
    );
  }

  const synced = [];
  const skipped = [];

  for (const rel of DATA_REL_PATHS) {
    try {
      const data = await driver.readJsonFile(rel, null);
      if (data === null || data === undefined) {
        skipped.push(rel);
        continue;
      }
      await fileStore.writeJsonFileAtomic(rel, data);
      synced.push(rel);
    } catch (err) {
      return bad(
        'errors.storage.sync_failed',
        `Sync failed on ${rel}: ${err?.message || err}`,
        500,
        { file: rel, reason: err?.message || String(err) },
      );
    }
  }

  return NextResponse.json({
    detail_key: 'success.storage.sync_cloud_to_local',
    driver: config.driver,
    synced,
    skipped,
    at: new Date().toISOString(),
  });
});
