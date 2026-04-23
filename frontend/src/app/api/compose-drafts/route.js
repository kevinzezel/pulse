import { NextResponse } from 'next/server';
import { readStore, writeStore, withStoreLock } from '@/lib/storage';
import { withAuth } from '@/lib/auth';

const REL = 'data/compose-drafts.json';
const EMPTY = { drafts: {}, updated_at: null };

const KEY_RE = /^[A-Za-z0-9_-]+::[A-Za-z0-9_-]+$/;

function normalizeDraft(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const text = typeof raw.text === 'string' ? raw.text : '';
  if (!text || !text.trim()) return null;
  const out = { text };
  out.updated_at = new Date().toISOString();
  return out;
}

function normalizePayload(raw) {
  const now = new Date().toISOString();
  if (!raw || typeof raw !== 'object') return { drafts: {}, updated_at: now };
  const draftsIn = raw.drafts && typeof raw.drafts === 'object' ? raw.drafts : {};
  const drafts = {};
  for (const [key, value] of Object.entries(draftsIn)) {
    if (typeof key !== 'string' || !KEY_RE.test(key)) continue;
    const normalized = normalizeDraft(value);
    if (normalized) drafts[key] = normalized;
  }
  return { drafts, updated_at: now };
}

export const GET = withAuth(async () => {
  const data = await readStore(REL, EMPTY);
  return NextResponse.json(data);
});

export const PUT = withAuth(async (req) => {
  const body = await req.json();
  const cleaned = normalizePayload(body);
  await withStoreLock(REL, async () => {
    await writeStore(REL, cleaned);
  });
  return NextResponse.json(cleaned);
});
