import { NextResponse } from 'next/server';
import { readLocalStore } from '@/lib/projectStorage';
import { withAuth } from '@/lib/auth';

const REL = 'data/intelligence-config.json';
const EMPTY = { providers: {}, updated_at: null };

const DEFAULT_GEMINI_MODEL = 'gemini-3-flash-preview';
// Hard ceiling on inline base64 audio for the Gemini API (we keep margin under
// the 20 MB request budget — base64 inflates ~4/3, so 8 MB raw ≈ 11 MB encoded).
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const MAX_MULTIPART_BYTES = MAX_AUDIO_BYTES + 512 * 1024;
// Defense-in-depth: even before reading the body we cap how long a request can
// run before we abort the upstream call.
const GEMINI_TIMEOUT_MS = 30_000;

const ACCEPTED_MIME_PREFIXES = ['audio/'];

const TRANSCRIBE_PROMPT = (
  'Transcribe this audio recording verbatim. ' +
  'Preserve the speaker\'s language and natural punctuation. ' +
  'Return only the transcript text, with no preface, no quotes and no commentary.'
);

function bad(detailKey, detail, status = 400, params) {
  const body = { detail, detail_key: detailKey };
  if (params) body.detail_params = params;
  return NextResponse.json(body, { status });
}

function bytesToBase64(uint8) {
  // Avoid String.fromCharCode.apply blow-ups on long buffers.
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < uint8.length; i += chunkSize) {
    const chunk = uint8.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return Buffer.from(binary, 'binary').toString('base64');
}

async function callGemini({ apiKey, model, mimeType, audioBytes }) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: TRANSCRIBE_PROMPT },
          {
            inline_data: {
              mime_type: mimeType,
              data: bytesToBase64(audioBytes),
            },
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
      // Cap output so a corrupted/silent recording can't run away.
      maxOutputTokens: 4096,
    },
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const upstream = data?.error?.message || `HTTP ${res.status}`;
    const err = new Error(upstream);
    err.status = res.status;
    err.upstream = upstream;
    throw err;
  }
  const candidate = data?.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  const text = parts
    .map((p) => (typeof p?.text === 'string' ? p.text : ''))
    .join('')
    .trim();
  return { text, finishReason: candidate?.finishReason || null };
}

export const POST = withAuth(async (req) => {
  const contentLength = Number(req.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_MULTIPART_BYTES) {
    return bad('errors.intelligence.audio_too_large', 'Audio exceeds maximum size', 413, {
      max_mb: Math.floor(MAX_AUDIO_BYTES / (1024 * 1024)),
    });
  }

  let form;
  try {
    form = await req.formData();
  } catch {
    return bad('errors.invalid_body', 'Invalid form data', 400);
  }

  const file = form.get('audio');
  if (!file || typeof file === 'string') {
    return bad('errors.intelligence.audio_required', 'Audio file is required', 400);
  }
  const mimeType = (typeof file.type === 'string' && file.type.trim()) || 'audio/wav';
  if (!ACCEPTED_MIME_PREFIXES.some((p) => mimeType.startsWith(p))) {
    return bad('errors.intelligence.audio_invalid_type', 'Unsupported audio mime type', 400, { mime: mimeType });
  }

  const arrayBuffer = await file.arrayBuffer();
  const audioBytes = new Uint8Array(arrayBuffer);
  if (audioBytes.byteLength === 0) {
    return bad('errors.intelligence.audio_empty', 'Audio is empty', 400);
  }
  if (audioBytes.byteLength > MAX_AUDIO_BYTES) {
    return bad('errors.intelligence.audio_too_large', 'Audio exceeds maximum size', 413, {
      max_mb: Math.floor(MAX_AUDIO_BYTES / (1024 * 1024)),
    });
  }

  const stored = await readLocalStore(REL, EMPTY);
  const gemini = stored?.providers?.gemini;
  const apiKey = gemini && typeof gemini.api_key === 'string' ? gemini.api_key.trim() : '';
  if (!apiKey) {
    return bad('errors.intelligence.gemini.not_configured', 'Gemini API key not configured', 412);
  }
  const model = (gemini && typeof gemini.model === 'string' && gemini.model.trim()) || DEFAULT_GEMINI_MODEL;

  let result;
  try {
    result = await callGemini({ apiKey, model, mimeType, audioBytes });
  } catch (err) {
    const aborted = err?.name === 'AbortError';
    return bad(
      aborted ? 'errors.intelligence.gemini.timeout' : 'errors.intelligence.gemini.upstream_failed',
      aborted ? 'Gemini API timed out' : `Gemini API failed: ${err?.upstream || err?.message || err}`,
      aborted ? 504 : 502,
      aborted ? undefined : { reason: err?.upstream || err?.message || String(err) },
    );
  }

  if (!result.text) {
    return bad('errors.intelligence.gemini.empty_transcript', 'Empty transcript from Gemini', 502, {
      reason: result.finishReason || 'no-text',
    });
  }

  return NextResponse.json({
    transcript: result.text,
    model,
    detail_key: 'success.intelligence.transcribed',
  });
});
