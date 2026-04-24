import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';

const GITHUB_REPO = 'kevinzezel/pulse';
const RELEASES_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

const CACHE_TTL_MS = 60 * 60 * 1000;        // 1h fresh
const NEGATIVE_CACHE_TTL_MS = 5 * 60 * 1000; // 5min after a failure
const FETCH_TIMEOUT_MS = 10_000;
const BACKOFF_DELAYS_MS = [0, 1000, 2000];   // 3 attempts total

let cache = {
  latestVersion: null,
  checkedAt: null,
  lastErrorAt: null,
  rateLimitResetAt: null,
};

// Coalesce concurrent cold-start fetches into one. Without this, the first N
// requests that hit a cold cache (or right after TTL expiry across multiple
// browser tabs) would each spawn a parallel GitHub round-trip — wasting the
// 60 req/h unauthenticated budget and racing on the cache assignment.
let inFlight = null;

function stripV(tag) {
  return typeof tag === 'string' && tag.startsWith('v') ? tag.slice(1) : tag;
}

async function fetchOnce(signal) {
  const res = await fetch(RELEASES_URL, {
    method: 'GET',
    headers: {
      'User-Agent': 'pulse-update-check',
      'Accept': 'application/vnd.github+json',
    },
    signal,
    cache: 'no-store',
  });
  return res;
}

// Returns { ok: true, tagName } | { ok: false, kind: 'rate_limit'|'transient'|'fatal', resetAt? }
async function fetchLatestReleaseWithBackoff() {
  for (let attempt = 0; attempt < BACKOFF_DELAYS_MS.length; attempt++) {
    const delay = BACKOFF_DELAYS_MS[attempt];
    if (delay > 0) {
      await new Promise((r) => setTimeout(r, delay));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const res = await fetchOnce(controller.signal);
      clearTimeout(timer);

      if (res.ok) {
        const data = await res.json().catch(() => null);
        const tagName = data?.tag_name;
        if (typeof tagName === 'string' && tagName.length > 0) {
          return { ok: true, tagName };
        }
        // 200 but no tag_name — treat as fatal (something weird with the response)
        console.warn('[update-status] GitHub 200 without tag_name');
        return { ok: false, kind: 'fatal' };
      }

      // Rate limit detection: 403 + X-RateLimit-Remaining: 0
      if (res.status === 403) {
        const remaining = res.headers.get('x-ratelimit-remaining');
        if (remaining === '0') {
          const resetHeader = res.headers.get('x-ratelimit-reset');
          const resetAt = resetHeader ? parseInt(resetHeader, 10) * 1000 : null;
          console.warn(
            `[update-status] GitHub rate limit hit, will retry after ${
              resetAt ? new Date(resetAt).toISOString() : 'unknown'
            }`,
          );
          return { ok: false, kind: 'rate_limit', resetAt };
        }
      }

      // 5xx: transient, eligible for retry
      if (res.status >= 500 && res.status < 600) {
        if (attempt < BACKOFF_DELAYS_MS.length - 1) continue;
        console.warn(`[update-status] GitHub ${res.status} after retries`);
        return { ok: false, kind: 'transient' };
      }

      // Other 4xx (404, 401, 403 without rate limit): not transient
      console.warn(`[update-status] GitHub ${res.status}, not retrying`);
      return { ok: false, kind: 'fatal' };
    } catch (err) {
      clearTimeout(timer);
      // network error / timeout / abort
      if (attempt < BACKOFF_DELAYS_MS.length - 1) continue;
      console.warn(`[update-status] GitHub fetch failed after retries: ${err?.message || err}`);
      return { ok: false, kind: 'transient' };
    }
  }
  return { ok: false, kind: 'transient' };
}

export const GET = withAuth(async () => {
  const now = Date.now();

  // Fresh cache
  if (cache.checkedAt && (now - cache.checkedAt) < CACHE_TTL_MS) {
    return NextResponse.json({
      latestVersion: cache.latestVersion,
      checkedAt: cache.checkedAt,
      source: 'cache',
    });
  }

  // Respect GitHub rate limit reset
  if (cache.rateLimitResetAt && now < cache.rateLimitResetAt) {
    return NextResponse.json({
      latestVersion: cache.latestVersion,
      checkedAt: cache.checkedAt,
      source: 'rate_limited',
    });
  }

  // Negative cache: don't hammer GitHub right after a failure
  if (cache.lastErrorAt && (now - cache.lastErrorAt) < NEGATIVE_CACHE_TTL_MS) {
    if (cache.latestVersion) {
      return NextResponse.json({
        latestVersion: cache.latestVersion,
        checkedAt: cache.checkedAt,
        source: 'stale',
      });
    }
    return NextResponse.json({
      latestVersion: null,
      error: 'github_unavailable',
    });
  }

  if (!inFlight) {
    inFlight = fetchLatestReleaseWithBackoff().finally(() => { inFlight = null; });
  }
  const result = await inFlight;

  if (result.ok) {
    cache.latestVersion = stripV(result.tagName);
    cache.checkedAt = Date.now();
    cache.lastErrorAt = null;
    cache.rateLimitResetAt = null;
    return NextResponse.json({
      latestVersion: cache.latestVersion,
      checkedAt: cache.checkedAt,
      source: 'github',
    });
  }

  // Failure path — record and serve stale if available
  cache.lastErrorAt = Date.now();
  if (result.kind === 'rate_limit' && result.resetAt) {
    cache.rateLimitResetAt = result.resetAt;
  }

  if (cache.latestVersion) {
    return NextResponse.json({
      latestVersion: cache.latestVersion,
      checkedAt: cache.checkedAt,
      source: 'stale',
    });
  }

  return NextResponse.json({
    latestVersion: null,
    error: 'github_unavailable',
  });
});
