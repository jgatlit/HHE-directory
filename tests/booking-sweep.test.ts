import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

/**
 * The sweep is the only thing in the codebase that mails BUYERS unprompted, so the assertions
 * here are mostly about restraint: who is NOT mailed, and that a run which sent nothing still
 * reports why.
 */
const mocks = vi.hoisted(() => ({
  findMany: vi.fn<(args: unknown) => Promise<unknown[]>>(),
  updateMany: vi.fn<(args: unknown) => Promise<{ count: number }>>(),
  update: vi.fn<(args: unknown) => Promise<unknown>>(),
  sendEmail: vi.fn<(args: unknown) => Promise<{ id: string }>>(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    bookingIntent: {
      findMany: mocks.findMany,
      updateMany: mocks.updateMany,
      update: mocks.update,
    },
  },
}));
vi.mock('@/lib/email', () => ({ sendEmail: mocks.sendEmail }));
vi.mock('@/lib/site', () => ({ SITE_URL: 'https://naturalhealthpros.com' }));

type Handler = (request: Request) => Promise<Response>;
let GET: Handler;

const HOUR_AGO = new Date(Date.now() - 60 * 60 * 1000);
const HALF_HOUR_AGO = new Date(Date.now() - 30 * 60 * 1000);

function intent(over: Record<string, unknown> = {}) {
  return {
    id: 'int_1',
    publicToken: 'tok_abc',
    name: 'Dana Reed',
    email: 'dana@example.com',
    status: 'SCHEDULED',
    paidAt: null,
    createdAt: HOUR_AGO,
    scheduledAt: HALF_HOUR_AGO,
    resumeEmailSentAt: null,
    whopCheckoutSessionId: 'chs_1',
    practitioner: { slug: 'sarah', displayName: 'Sarah Schindler', whopPayoutsEnabled: true },
    offering: {
      title: 'Root Cause Release',
      archived: false,
      acceptsPayments: true,
      whopPlanId: 'plan_1',
      priceUsdCents: 5500,
      isConsult: false,
    },
    ...over,
  };
}

beforeAll(async () => {
  ({ GET } = await import('@/app/api/cron/booking-sweep/route'));
});

/**
 * The route runs TWO findMany queries — resume candidates, then practitioner notices — so the
 * mock dispatches on the query rather than answering both with the same rows. A shared
 * mockResolvedValue fed the notice loop rows shaped for the resume loop, which crashed the route
 * and made every send assertion fail for a reason that had nothing to do with the assertion.
 */
function whenQueried({ resume = [], notify = [], paid = [] }: { resume?: unknown[]; notify?: unknown[]; paid?: unknown[] }) {
  mocks.findMany.mockImplementation(async (args) => {
    const where = (args as { where: Record<string, unknown> }).where;
    if ('resumeEmailSentAt' in where) return resume;
    if ('paidNoticeSentAt' in where) return paid;
    return notify;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  process.env.RESEND_API_KEY = 'test-key';
  delete process.env.CRON_SECRET;
  whenQueried({});
  mocks.updateMany.mockResolvedValue({ count: 0 });
  mocks.update.mockResolvedValue({});
  mocks.sendEmail.mockResolvedValue({ id: 'msg_1' });
});

const req = (headers: Record<string, string> = {}) =>
  new Request('https://x/api/cron/booking-sweep', { headers });

describe('auth', () => {
  it('is open when CRON_SECRET is unset OUTSIDE production, so local dev can curl it', async () => {
    expect((await GET(req())).status).toBe(200);
  });

  it('requires the bearer token when CRON_SECRET is set', async () => {
    process.env.CRON_SECRET = 's3cret';
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req({ authorization: 'Bearer wrong' }))).status).toBe(401);
    expect((await GET(req({ authorization: 'Bearer s3cret' }))).status).toBe(200);
  });

  // The open-when-unset shape came from /api/health/search, which is READ-ONLY. This route
  // relabels rows in bulk and mails buyers from the verified domain, so a missing secret on a
  // deployed environment must fail closed rather than expose that to anyone who guesses the path.
  it('FAILS CLOSED in production when CRON_SECRET is missing', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const res = await GET(req());
    expect(res.status).toBe(503);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it('reports a missing RESEND_API_KEY, but still runs the relabel that needs no email', async () => {
    delete process.env.RESEND_API_KEY;
    const res = await GET(req());
    const body = (await res.json()) as { ok: boolean; emailConfigured: boolean };
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(body.emailConfigured).toBe(false);
    expect(body.ok).toBe(false);
    // Freezing the lead queue over an email key it does not depend on would be its own bug.
    expect(mocks.updateMany).toHaveBeenCalled();
  });
});

describe('who gets mailed', () => {
  it('mails the BUYER, not the practitioner, with the token URL', async () => {
    whenQueried({ resume: [intent()] });
    await GET(req());
    const arg = mocks.sendEmail.mock.calls[0]![0] as { to: string; text: string };
    expect(arg.to).toBe('dana@example.com');
    // Addressed by the random publicToken — this URL is going into an inbox.
    expect(arg.text).toContain('/practitioners/sarah/book/tok_abc');
    expect(arg.text).not.toContain('int_1');
  });

  it('keys idempotency on the intent, which is what makes a 15-minute cron safe', async () => {
    whenQueried({ resume: [intent()] });
    await GET(req());
    const arg = mocks.sendEmail.mock.calls[0]![0] as { idempotencyKey: string };
    // Without this the same buyer is mailed every 15 minutes until they pay.
    expect(arg.idempotencyKey).toBe('booking-resume/int_1');
  });

  it('skips a free consultation and says so, rather than skipping silently', async () => {
    whenQueried({ resume: [intent({ offering: { ...intent().offering, isConsult: true } })] });
    const res = await GET(req());
    const body = (await res.json()) as { resume: { sent: number; skipped: number }; skipReasons: Record<string, number> };
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(body.resume.skipped).toBe(1);
    expect(body.skipReasons.free).toBe(1);
  });

  it('skips when payments were never live for that offering', async () => {
    whenQueried({ resume: [intent({ practitioner: { ...intent().practitioner, whopPayoutsEnabled: false } })] });
    const body = (await (await GET(req())).json()) as { skipReasons: Record<string, number> };
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(body.skipReasons['payments-not-live']).toBe(1);
  });

  it('queries unpaid, never-yet-mailed, old-enough intents', async () => {
    await GET(req());
    const where = (mocks.findMany.mock.calls[0]![0] as { where: Record<string, unknown> }).where;
    expect(where.paidAt).toBeNull();
    // Exactly-once. Without this the same buyer is re-selected every run forever.
    expect(where.resumeEmailSentAt).toBeNull();
    // The 15-minute capture anchor must be IN THE QUERY, not only in resumeDecision — otherwise
    // dropping it here silently widens who is considered.
    const createdAt = where.createdAt as { lte: Date };
    expect(createdAt.lte.getTime()).toBeLessThanOrEqual(Date.now() - 15 * 60 * 1000);
    // NO listing gate. It was applied here because a delisted practitioner's flow page used to
    // 404, which made a resume link a dead end — a symptom of the gate on the flow, not a reason
    // for one here. Unlisted profiles stay bookable at their direct link, so the link resolves
    // and that buyer is recoverable exactly like any other.
    expect(where.practitioner).toBeUndefined();
    // BOTH routes into state (b): scheduled, and the no-scheduler cohort that reached checkout.
    expect(JSON.stringify(where.OR)).toContain('SCHEDULED');
    expect(JSON.stringify(where.OR)).toContain('whopCheckoutSessionId');
  });

  it('marks the intent sent only AFTER the send succeeds', async () => {
    whenQueried({ resume: [intent()] });
    await GET(req());
    const call = mocks.update.mock.calls[0]![0] as { where: { id: string }; data: Record<string, unknown> };
    expect(call.where.id).toBe('int_1');
    expect(call.data.resumeEmailSentAt).toBeInstanceOf(Date);
  });

  it('does NOT mark sent when the send throws, so the intent is retried', async () => {
    whenQueried({ resume: [intent()] });
    mocks.sendEmail.mockRejectedValueOnce(new Error('bounced'));
    await GET(req());
    expect(mocks.update).not.toHaveBeenCalled();
  });
});

describe('failure reporting', () => {
  it('keeps sending after one bad address, and reports the failure with a 207', async () => {
    whenQueried({ resume: [intent({ id: 'int_1' }), intent({ id: 'int_2' })] });
    mocks.sendEmail.mockRejectedValueOnce(new Error('bounced'));
    const res = await GET(req());
    expect(res.status).toBe(207);
    const body = (await res.json()) as { ok: boolean; resume: { sent: number; failed: number }; failures: unknown[] };
    expect(body.ok).toBe(false);
    expect(body.resume.sent).toBe(1);
    expect(body.resume.failed).toBe(1);
    expect(body.failures).toHaveLength(1);
  });
});

describe('cold leads — state (a)', () => {
  it('relabels only PENDING intents, never SCHEDULED ones', async () => {
    mocks.updateMany.mockResolvedValue({ count: 3 });
    const body = (await (await GET(req())).json()) as { abandoned: number };
    const args = mocks.updateMany.mock.calls[0]![0] as {
      where: { status: string; paidAt: null };
      data: { status: string };
    };
    expect(args.where.status).toBe('PENDING');
    expect(args.data.status).toBe('ABANDONED');
    expect(body.abandoned).toBe(3);
  });

  // THE DESTRUCTIVE HALF. Without asserting the age cutoff, setting COLD_LEAD_MS to 0 — or
  // dropping the createdAt clause entirely — passes every other test in both files while the next
  // cron run relabels every live lead, including one captured thirty seconds ago.
  it('only relabels leads older than the cold-lead window', async () => {
    await GET(req());
    const args = mocks.updateMany.mock.calls[0]![0] as { where: { createdAt: { lte: Date } } };
    const cutoff = args.where.createdAt.lte;
    expect(cutoff).toBeInstanceOf(Date);
    // Comfortably in the past — a few days at minimum, never "now".
    expect(cutoff.getTime()).toBeLessThan(Date.now() - 24 * 60 * 60 * 1000);
  });

  // A PENDING intent WITH a checkout session is §5's 1 → 3 cohort: they reached a real checkout
  // and are recoverable. Sweeping them in here would file a live buyer as abandoned.
  it('never relabels a PENDING intent that reached a checkout', async () => {
    await GET(req());
    const args = mocks.updateMany.mock.calls[0]![0] as { where: { whopCheckoutSessionId: null } };
    expect(args.where.whopCheckoutSessionId).toBeNull();
  });

  it('sends no buyer email for state (a) — they never reached a checkout', async () => {
    whenQueried({});
    mocks.updateMany.mockResolvedValue({ count: 5 });
    await GET(req());
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });
});

/**
 * The practitioner notice moved OUT of `recordScheduleSignal` and into this cron. Inline it put a
 * Resend round-trip on the buyer's critical path at the highest-drop-off moment in the flow, and
 * — because that endpoint is public, unauthenticated and has no per-practitioner burst bound —
 * it bypassed the flood guard the sibling capture action exists to provide.
 */
describe('practitioner notices', () => {
  function scheduledRow(over: Record<string, unknown> = {}) {
    return {
      id: 'int_9',
      name: 'Dana Reed',
      email: 'dana@example.com',
      phone: null,
      scheduleSignal: 'SELF_REPORT',
      practitioner: {
        slug: 'sarah',
        whopPayoutsEnabled: true,
        user: { email: 'sarah@example.com' },
      },
      offering: {
        title: 'Root Cause Release',
        archived: false,
        priceUsdCents: 5500,
        acceptsPayments: true,
        whopPlanId: 'plan_1',
      },
      ...over,
    };
  }

  it('mails the PRACTITIONER, once, and marks it sent', async () => {
    whenQueried({ notify: [scheduledRow()] });
    await GET(req());
    const arg = mocks.sendEmail.mock.calls[0]![0] as { to: string; idempotencyKey: string };
    expect(arg.to).toBe('sarah@example.com');
    expect(arg.idempotencyKey).toBe('booking-scheduled/int_9');
    const upd = mocks.update.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(upd.data.scheduledNoticeSentAt).toBeInstanceOf(Date);
  });

  it('only considers intents not already notified', async () => {
    await GET(req());
    const notifyCall = mocks.findMany.mock.calls
      .map((c) => (c[0] as { where: Record<string, unknown> }).where)
      .find((w) => 'scheduledNoticeSentAt' in w);
    expect(notifyCall).toBeTruthy();
    expect(notifyCall!.scheduledNoticeSentAt).toBeNull();
    expect(notifyCall!.status).toBe('SCHEDULED');
  });

  // An offering archived after capture owes nothing — the flow page stops rendering its checkout
  // entirely — so telling the practitioner to chase payment sends them after money the buyer has
  // no way to give them.
  it('does not claim payment is outstanding on an archived offering', async () => {
    whenQueried({ notify: [scheduledRow({ offering: { ...scheduledRow().offering, archived: true } })] });
    await GET(req());
    const arg = mocks.sendEmail.mock.calls[0]![0] as { text: string };
    expect(arg.text).not.toContain('not completed payment');
  });

  // §11's toggle offers "tell me on checkout instead", but no checkout-time notification exists
  // anywhere in this codebase — so gating here would suppress with no substitute, leaving a
  // practitioner never told that a stranger is on their calendar.
  it('is NOT gated by the lead-email preference', async () => {
    whenQueried({
      notify: [scheduledRow({ practitioner: { ...scheduledRow().practitioner, notifyLeadsImmediately: false } })],
    });
    await GET(req());
    expect(mocks.sendEmail).toHaveBeenCalled();
  });
});

/**
 * Payment confirmations. Before these, `sendEmail` appeared only in the capture lead email,
 * trial-sweep and this sweep — so a successful payment notified NEITHER side, while the dashboard
 * silently dropped the row (it filtered `paidAt: null`), making "collected" and "deleted"
 * indistinguishable from the practitioner's side.
 */
describe('payment confirmations', () => {
  function paidRow(over: Record<string, unknown> = {}) {
    return {
      id: 'int_p',
      publicToken: 'tok_p',
      name: 'Dana Reed',
      email: 'dana@example.com',
      phone: null,
      status: 'PAID',
      scheduledAt: new Date(),
      practitioner: { slug: 'sarah', displayName: 'Sarah Schindler', user: { email: 'sarah@example.com' } },
      offering: { title: 'Root Cause Release', priceUsdCents: 5500 },
      ...over,
    };
  }

  it('emails BOTH the buyer and the practitioner, with distinct idempotency keys', async () => {
    whenQueried({ paid: [paidRow()] });
    await GET(req());
    const to = mocks.sendEmail.mock.calls.map((c) => (c[0] as { to: string }).to);
    expect(to).toContain('dana@example.com');
    expect(to).toContain('sarah@example.com');
    const keys = mocks.sendEmail.mock.calls.map((c) => (c[0] as { idempotencyKey: string }).idempotencyKey);
    // Distinct, or Resend's 24h de-dup would swallow the second send entirely.
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain('booking-paid-buyer/int_p');
    expect(keys).toContain('booking-paid-practitioner/int_p');
  });

  it('only selects paid intents not already notified', async () => {
    await GET(req());
    const where = mocks.findMany.mock.calls
      .map((c) => (c[0] as { where: Record<string, unknown> }).where)
      .find((w) => 'paidNoticeSentAt' in w);
    expect(where).toBeTruthy();
    expect(where!.paidNoticeSentAt).toBeNull();
    expect(where!.paidAt).toEqual({ not: null });
  });

  it('marks sent only after BOTH sends succeed, so a partial failure retries', async () => {
    whenQueried({ paid: [paidRow()] });
    // Practitioner send fails; buyer send already succeeded.
    mocks.sendEmail.mockResolvedValueOnce({ id: 'm1' }).mockRejectedValueOnce(new Error('bounced'));
    const res = await GET(req());
    expect(mocks.update).not.toHaveBeenCalled();
    expect(res.status).toBe(207);
  });

  // A buyer CAN pay without picking a time — D8 never hard-gates — so the copy must not tell
  // that person they are all set.
  it('does not tell an unscheduled buyer they have a time booked', async () => {
    whenQueried({ paid: [paidRow({ scheduledAt: null })] });
    await GET(req());
    const buyer = mocks.sendEmail.mock.calls[0]![0] as { text: string };
    expect(buyer.text).toContain("haven't picked a time");
  });

  it('does not call its own email a receipt — Whop\'s receipt is neither sent nor verified by us', async () => {
    whenQueried({ paid: [paidRow()] });
    await GET(req());
    const buyer = mocks.sendEmail.mock.calls[0]![0] as { text: string; subject: string };
    expect(`${buyer.subject} ${buyer.text}`.toLowerCase()).not.toContain('receipt');
  });
});
