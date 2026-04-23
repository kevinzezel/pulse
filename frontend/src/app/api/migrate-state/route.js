import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { withAuth } from '@/lib/auth';
import { readStore, writeStore, withStoreLock, getActiveDriver } from '@/lib/storage';

const LAYOUTS_REL = 'data/layouts.json';
const VIEW_STATE_REL = 'data/view-state.json';

const FRONTEND_ROOT = process.env.PULSE_FRONTEND_ROOT || process.cwd();

function isEmpty(obj) {
  return !obj || typeof obj !== 'object' || Object.keys(obj).length === 0;
}

async function readAndClear(relPath, contentKey) {
  return withStoreLock(relPath, async () => {
    const data = await readStore(relPath, null);
    const content = data && typeof data === 'object' ? data[contentKey] : null;
    const hadData = content && typeof content === 'object' && !Array.isArray(content) && Object.keys(content).length > 0;

    if (hadData) {
      // Esvazia primeiro (funciona em qualquer driver: file/mongo/s3).
      await writeStore(relPath, { [contentKey]: {} }).catch(() => {});
      // Best-effort: apaga fisicamente quando driver = file.
      if (getActiveDriver() === 'file') {
        try {
          await fs.unlink(path.join(FRONTEND_ROOT, relPath));
        } catch {}
      }
      return content;
    }
    return null;
  });
}

export const GET = withAuth(async () => {
  const [layouts, viewState] = await Promise.all([
    readAndClear(LAYOUTS_REL, 'layouts').catch(() => null),
    readAndClear(VIEW_STATE_REL, 'view_state').catch(() => null),
  ]);
  return NextResponse.json({
    layouts: isEmpty(layouts) ? null : layouts,
    view_state: isEmpty(viewState) ? null : viewState,
  });
});
