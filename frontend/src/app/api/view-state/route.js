import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { readStore, writeStore, withStoreLock } from '@/lib/storage';

const REL = 'data/view-state.json';
const EMPTY = { view_state: {} };

function normalize(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof key !== 'string' || !key) continue;
    if (value === undefined || value === null) {
      out[key] = null;
    } else if (typeof value === 'string') {
      out[key] = value;
    }
  }
  return out;
}

async function readViewState() {
  const data = await readStore(REL, EMPTY);
  const vs = data?.view_state;
  if (!vs || typeof vs !== 'object' || Array.isArray(vs)) return {};
  return normalize(vs);
}

export const GET = withAuth(async () => {
  const viewState = await readViewState();
  return NextResponse.json({ view_state: viewState });
});

export const PUT = withAuth(async (req) => {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ detail: 'Invalid JSON', detail_key: 'errors.invalid_body' }, { status: 400 });
  }
  if (!body || typeof body.view_state !== 'object' || Array.isArray(body.view_state)) {
    return NextResponse.json({ detail: 'Expected { view_state: {...} }', detail_key: 'errors.invalid_body' }, { status: 400 });
  }
  const viewState = await withStoreLock(REL, async () => {
    const next = normalize(body.view_state);
    await writeStore(REL, { view_state: next });
    return next;
  });
  return NextResponse.json({ view_state: viewState });
});
