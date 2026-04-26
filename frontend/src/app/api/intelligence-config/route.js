import { NextResponse } from 'next/server';
import { readStore, writeStore, withStoreLock } from '@/lib/storage';
import { withAuth } from '@/lib/auth';

const REL = 'data/intelligence-config.json';
const EMPTY = { providers: {}, updated_at: null };

const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const API_KEY_MAX = 256;

function bad(detailKey, detail, status = 400, params) {
  const body = { detail, detail_key: detailKey };
  if (params) body.detail_params = params;
  return NextResponse.json(body, { status });
}

function maskKey(key) {
  if (!key || typeof key !== 'string') return null;
  if (key.length <= 6) return '••••';
  const tail = key.slice(-4);
  return `••••${tail}`;
}

function publicShape(stored) {
  const providers = (stored && typeof stored === 'object' && stored.providers) || {};
  const gemini = providers.gemini && typeof providers.gemini === 'object' ? providers.gemini : null;
  return {
    providers: {
      gemini: {
        configured: !!(gemini && typeof gemini.api_key === 'string' && gemini.api_key.length > 0),
        masked: gemini ? maskKey(gemini.api_key) : null,
        model: gemini?.model || DEFAULT_GEMINI_MODEL,
        updated_at: gemini?.updated_at || null,
      },
    },
    updated_at: stored?.updated_at || null,
  };
}

export const GET = withAuth(async () => {
  const data = await readStore(REL, EMPTY);
  return NextResponse.json(publicShape(data));
});

export const PUT = withAuth(async (req) => {
  let body;
  try { body = await req.json(); }
  catch { return bad('errors.invalid_body', 'Invalid JSON'); }

  const geminiIn = body?.gemini && typeof body.gemini === 'object' ? body.gemini : null;
  if (!geminiIn) {
    return bad('errors.intelligence.payload_required', 'Provider payload required', 400);
  }
  const apiKey = typeof geminiIn.api_key === 'string' ? geminiIn.api_key.trim() : '';
  if (apiKey.length > API_KEY_MAX) {
    return bad('errors.intelligence.gemini.api_key_too_long', 'API key too long', 400, { max: API_KEY_MAX });
  }
  const requestedModel = typeof geminiIn.model === 'string' ? geminiIn.model.trim() : '';
  const model = GEMINI_MODELS.includes(requestedModel) ? requestedModel : DEFAULT_GEMINI_MODEL;

  const existing = await readStore(REL, EMPTY);
  const existingGemini = existing?.providers?.gemini && typeof existing.providers.gemini === 'object'
    ? existing.providers.gemini
    : null;
  const existingApiKey = typeof existingGemini?.api_key === 'string' ? existingGemini.api_key.trim() : '';
  if (!apiKey && !existingApiKey) {
    return bad('errors.intelligence.gemini.api_key_required', 'Gemini API key is required');
  }

  const now = new Date().toISOString();
  const next = await withStoreLock(REL, async () => {
    const current = await readStore(REL, EMPTY);
    const providers = (current && typeof current === 'object' && current.providers) || {};
    const currentGemini = providers.gemini && typeof providers.gemini === 'object' ? providers.gemini : null;
    const currentApiKey = typeof currentGemini?.api_key === 'string' ? currentGemini.api_key.trim() : '';
    const merged = {
      providers: {
        ...providers,
        gemini: {
          api_key: apiKey || currentApiKey || existingApiKey,
          model,
          updated_at: now,
        },
      },
      updated_at: now,
    };
    await writeStore(REL, merged);
    return merged;
  });

  return NextResponse.json({
    detail_key: 'success.intelligence.gemini_saved',
    ...publicShape(next),
  });
});

export const DELETE = withAuth(async (req) => {
  const url = new URL(req.url);
  const provider = url.searchParams.get('provider');
  const now = new Date().toISOString();

  const next = await withStoreLock(REL, async () => {
    const current = await readStore(REL, EMPTY);
    const providers = (current && typeof current === 'object' && current.providers) || {};
    const cleaned = { ...providers };
    if (provider) {
      delete cleaned[provider];
    } else {
      for (const key of Object.keys(cleaned)) delete cleaned[key];
    }
    const merged = { providers: cleaned, updated_at: now };
    await writeStore(REL, merged);
    return merged;
  });

  return NextResponse.json({
    detail_key: 'success.intelligence.cleared',
    ...publicShape(next),
  });
});
