import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Covers rateLimit()'s unconfigured path directly — nothing else in this repo does.
 * tests/booking-signal.test.ts fully module-mocks `@/lib/rate-limit`, so the real hasKv gate, the
 * production check, and the once-per-process warn were exercised by nothing before this file.
 *
 * `hasKv` is a top-level `const`, computed once at module load from env vars present at that
 * moment — so every test needs `vi.resetModules()` + a fresh dynamic import AFTER setting env
 * vars, exactly like tests/email.test.ts does for the same reason (RESEND_API_KEY).
 */

const limit = vi.fn();
class FakeRatelimit {
  limit = limit;
  static slidingWindow(n: number, window: string) {
    return { n, window };
  }
}
vi.mock('@upstash/ratelimit', () => ({ Ratelimit: FakeRatelimit }));
vi.mock('@vercel/kv', () => ({ kv: {} }));
const captureMessage = vi.fn();
vi.mock('@sentry/nextjs', () => ({ captureMessage }));

async function importRateLimit() {
  return import('@/lib/rate-limit');
}

describe('rateLimit — unconfigured (no KV env vars)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    limit.mockReset();
    captureMessage.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('always allows — never fails closed', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { rateLimit } = await importRateLimit();

    const result = await rateLimit('test', 'id-1', { limit: 3, windowSeconds: 60 });

    expect(result).toEqual({ success: true, remaining: Infinity, reset: 0 });
    expect(limit).not.toHaveBeenCalled();
  });

  it('logs once in production, and does not log again on a second call in the same process', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { rateLimit } = await importRateLimit();

    await rateLimit('test', 'id-1', { limit: 3, windowSeconds: 60 });
    await rateLimit('test', 'id-2', { limit: 3, windowSeconds: 60 });

    expect(console.error).toHaveBeenCalledTimes(1);
    expect(captureMessage).toHaveBeenCalledTimes(1);
  });

  it('stays silent outside production', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const { rateLimit } = await importRateLimit();

    await rateLimit('test', 'id-1', { limit: 3, windowSeconds: 60 });

    expect(console.error).not.toHaveBeenCalled();
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it('still allows the request even if the warning mechanism itself throws', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    captureMessage.mockImplementation(() => {
      throw new Error('sentry SDK exploded');
    });
    const { rateLimit } = await importRateLimit();

    // Must not reject — this runs on every unconfigured call to a public, unauthenticated
    // booking route with no try/catch at the call site.
    await expect(
      rateLimit('test', 'id-1', { limit: 3, windowSeconds: 60 }),
    ).resolves.toEqual({ success: true, remaining: Infinity, reset: 0 });
  });
});

describe('rateLimit — configured (KV env vars present)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv('NODE_ENV', 'production');
    process.env.KV_REST_API_URL = 'https://example.upstash.io';
    process.env.KV_REST_API_TOKEN = 'test-token';
    limit.mockReset();
    captureMessage.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('calls the real limiter and returns its result, without warning', async () => {
    limit.mockResolvedValue({ success: false, remaining: 0, reset: 1234 });
    const { rateLimit } = await importRateLimit();

    const result = await rateLimit('test-prefix', 'id-1', { limit: 3, windowSeconds: 60 });

    expect(result).toEqual({ success: false, remaining: 0, reset: 1234 });
    expect(limit).toHaveBeenCalledWith('id-1');
    expect(console.error).not.toHaveBeenCalled();
    expect(captureMessage).not.toHaveBeenCalled();
  });
});
