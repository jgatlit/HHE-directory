import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Covers `/api/cron/trial-sweep` — the cron that warns pilots before their trial ends and then
 * DELISTS the ones that have lapsed.
 *
 * This route had no tests until the sender underneath it was replaced, which is backwards: it
 * emails real practitioners and its second half is the only thing that actually applies the
 * paywall. The assertions below are deliberately about its FAILURE behaviour, because that is
 * what nobody exercises by hand:
 *
 *   - a bad send must not abort the run, and must not skip enforcement
 *   - a bad send must be counted AND attributed, never swallowed
 *   - a missing API key must fail loudly, not report "sent: 0" as success
 *
 * The last one is the failure this repo keeps re-learning: a silent no-op is indistinguishable
 * from a clean run, and `deleteFromIndex`'s bare catch left its own counter at zero for weeks.
 */

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  sendEmail: vi.fn(),
  indexPractitioner: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: { practitioner: { findMany: mocks.findMany } },
}));
vi.mock('@/lib/email', () => ({
  sendEmail: mocks.sendEmail,
  EMAIL_FROM: 'Test <test@example.com>',
  EmailNotConfigured: class EmailNotConfigured extends Error {},
}));
vi.mock('@/lib/practitioner-indexer', () => ({
  indexPractitioner: mocks.indexPractitioner,
}));

const prac = (id: string, email: string | null = `${id}@example.com`) => ({
  id,
  slug: id,
  trialEndsAt: new Date('2026-09-01T00:00:00Z'),
  user: { email },
});

/** Bucket queries filter on a trialEndsAt day-window; the enforcement query does not. */
const isBucketQuery = (args: { where?: { trialEndsAt?: unknown } }) =>
  !!(args?.where?.trialEndsAt as { gte?: unknown } | undefined)?.gte;

async function run() {
  const { GET } = await import('@/app/api/cron/trial-sweep/route');
  const res = await GET(new Request('http://localhost/api/cron/trial-sweep'));
  return { status: res.status, body: await res.json() };
}

describe('trial-sweep cron', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.RESEND_API_KEY = 're_test_key';
    delete process.env.CRON_SECRET; // open endpoint — auth is covered by its own guard
    mocks.findMany.mockReset();
    mocks.sendEmail.mockReset();
    mocks.indexPractitioner.mockReset();
    mocks.indexPractitioner.mockResolvedValue(undefined);
  });

  it('fails LOUD when RESEND_API_KEY is missing — never reports an empty run as success', async () => {
    delete process.env.RESEND_API_KEY;
    mocks.findMany.mockResolvedValue([]);

    const { status, body } = await run();

    expect(status).toBe(500);
    expect(body.error).toMatch(/RESEND_API_KEY/);
    // Nothing attempted, and crucially no "sent: 0" success shape.
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(body.ok).toBeUndefined();
  });

  it('one failed send does not abort the run — later recipients still receive theirs', async () => {
    mocks.findMany.mockImplementation(async (args: never) =>
      isBucketQuery(args) ? [prac('p1'), prac('p2'), prac('p3')] : [],
    );
    mocks.sendEmail.mockImplementation(async ({ to }: { to: string }) => {
      if (to === 'p2@example.com') throw new Error('Resend 422: invalid recipient');
      return { id: 'msg' };
    });

    const { body } = await run();

    // 3 practitioners × 3 buckets, one failing recipient in each.
    expect(mocks.sendEmail).toHaveBeenCalledTimes(9);
    expect(body.summary['T-14']).toMatchObject({ matched: 3, sent: 2, failed: 1 });
  });

  it('attributes each failure to its practitioner and bucket rather than swallowing it', async () => {
    mocks.findMany.mockImplementation(async (args: never) =>
      isBucketQuery(args) ? [prac('p1')] : [],
    );
    mocks.sendEmail.mockRejectedValue(new Error('Resend 500: upstream'));

    const { status, body } = await run();

    expect(status).toBe(207); // not 200 — a partial run must not look clean
    expect(body.ok).toBe(false);
    expect(body.failures).toHaveLength(3);
    expect(body.failures[0]).toMatchObject({ practitionerId: 'p1', bucket: 'T-14' });
    expect(body.failures[0].error).toMatch(/upstream/);
  });

  it('STILL RUNS ENFORCEMENT after send failures — the paywall must not depend on email', async () => {
    // The half that actually delists lapsed trials lives after the warning loop. If a throw
    // escaped the per-recipient catch, expired pilots would silently stay in /search.
    mocks.findMany.mockImplementation(async (args: never) =>
      isBucketQuery(args) ? [prac('p1')] : [prac('lapsed1'), prac('lapsed2')],
    );
    mocks.sendEmail.mockRejectedValue(new Error('every send is broken'));

    const { body } = await run();

    expect(mocks.indexPractitioner).toHaveBeenCalledTimes(2);
    expect(mocks.indexPractitioner).toHaveBeenCalledWith('lapsed1');
    expect(body.delisted).toMatchObject({ matched: 2, reconciled: 2, failed: 0 });
  });

  it('skips practitioners with no email address without counting them as sent or failed', async () => {
    mocks.findMany.mockImplementation(async (args: never) =>
      isBucketQuery(args) ? [prac('p1', null), prac('p2')] : [],
    );
    mocks.sendEmail.mockResolvedValue({ id: 'msg' });

    const { status, body } = await run();

    expect(status).toBe(200);
    expect(body.summary['T-14']).toMatchObject({ matched: 2, sent: 1, skipped: 1, failed: 0 });
  });

  it('keys idempotency per bucket AND per practitioner, so no warning suppresses another', async () => {
    mocks.findMany.mockImplementation(async (args: never) =>
      isBucketQuery(args) ? [prac('p1'), prac('p2')] : [],
    );
    mocks.sendEmail.mockResolvedValue({ id: 'msg' });

    await run();

    const keys = mocks.sendEmail.mock.calls.map((c) => c[0].idempotencyKey);
    expect(new Set(keys).size).toBe(keys.length); // all distinct
    expect(keys).toContain('trial-warn-T-14/p1');
    expect(keys).toContain('trial-warn-T-0/p2');
  });

  it('reports a fully clean run as 200 with ok:true', async () => {
    mocks.findMany.mockResolvedValue([]);

    const { status, body } = await run();

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.failures).toHaveLength(0);
  });
});
