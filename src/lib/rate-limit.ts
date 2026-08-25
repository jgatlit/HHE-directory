import { Ratelimit } from '@upstash/ratelimit';
import { kv } from '@vercel/kv';
import * as Sentry from '@sentry/nextjs';

// Env-gated: if Upstash/Vercel KV envs are missing, rate-limit no-ops (always allows).
// Wire real limits in Phase 2 per Decisions-JSON `rate-limiting: YES Phase 2`.

const hasKv = !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN;

/**
 * The early return above used to be silent — no log, no signal — which is exactly how a missing
 * KV_REST_API_URL/KV_REST_API_TOKEN went unnoticed for months across two public unauthenticated
 * routes (booking capture, booking signal). A missing/renamed env var, or a disconnected
 * marketplace resource, reproduces the same silent hole in the future with nothing to catch it
 * short of reading the source.
 *
 * Loud once per process, not per request — this fires on cold start / first call, not on every
 * hit to a public route. Deliberately does NOT fail closed: taking booking capture down entirely
 * because a KV var is missing would be strictly worse than an unenforced limit on a low-traffic
 * pilot. Loud and open is the trade.
 *
 * `console.error` is the signal that actually reaches anyone today. `Sentry.captureMessage` is
 * called alongside it to match this codebase's existing error-reporting convention (see
 * error.tsx, api/health/search), but — confirmed while writing this — Sentry.init() is not
 * called anywhere in this app (no sentry.*.config.*, no instrumentation.ts, no SENTRY_DSN in
 * .env), so every Sentry.capture* call in the codebase today, this one included, is inert. That
 * gap predates this change and is bigger than this file; flagged to the operator separately
 * rather than silently worked around here. Left in rather than removed so this starts reporting
 * for real the moment Sentry is actually wired up, with no further change needed here.
 */
let warnedUnconfigured = false;
function warnIfUnconfigured() {
  if (hasKv || warnedUnconfigured || process.env.NODE_ENV !== 'production') return;
  warnedUnconfigured = true;
  console.error(
    '[rate-limit] KV_REST_API_URL/KV_REST_API_TOKEN not set in production — rateLimit() is silently allowing everything on every caller (booking capture, booking signal). Reconnect the Upstash/Vercel KV integration.',
  );
  Sentry.captureMessage('rateLimit() unconfigured in production — running fully unlimited', 'warning');
}

type RateLimitConfig = {
  limit: number;
  windowSeconds: number;
};

type RateLimitResult = {
  success: boolean;
  remaining: number;
  reset: number;
};

// Signature mirrors fork's action-utils.ts caller contract: (prefix, identifier, config)
export async function rateLimit(
  prefix: string,
  identifier: string,
  config: RateLimitConfig,
): Promise<RateLimitResult> {
  if (!hasKv) {
    warnIfUnconfigured();
    return { success: true, remaining: Infinity, reset: 0 };
  }

  const limiter = new Ratelimit({
    redis: kv,
    limiter: Ratelimit.slidingWindow(config.limit, `${config.windowSeconds} s`),
    analytics: false,
    prefix,
  });

  const { success, remaining, reset } = await limiter.limit(identifier);
  return { success, remaining, reset };
}
