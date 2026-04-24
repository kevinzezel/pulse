import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

// Public route (no auth) — exposes the local install's version so the /login
// page can show "Pulse v1.10.0" before the user authenticates. Source of truth
// is $INSTALL_ROOT/VERSION ($PULSE_FRONTEND_ROOT/.. — same convention used by
// jsonStore.js / storage.js to survive systemd worker spawns where cwd drifts).

const TTL_MS = 60 * 1000; // 1min — version rarely changes mid-session

const FRONTEND_ROOT = process.env.PULSE_FRONTEND_ROOT || process.cwd();
const VERSION_PATH = path.resolve(FRONTEND_ROOT, '..', 'VERSION');

let cache = { value: null, checkedAt: 0 };

async function readInstallVersion() {
  try {
    const text = await fs.readFile(VERSION_PATH, 'utf8');
    const trimmed = text.trim();
    return trimmed || null;
  } catch {
    return null;
  }
}

export async function GET() {
  const now = Date.now();
  if (cache.checkedAt && (now - cache.checkedAt) < TTL_MS) {
    return NextResponse.json({ version: cache.value });
  }
  const v = await readInstallVersion();
  cache = { value: v, checkedAt: now };
  return NextResponse.json({ version: v });
}
