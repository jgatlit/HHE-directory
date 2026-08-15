import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

/**
 * The sweep is the only thing in the codebase that mails BUYERS unprompted, so the assertions
 * here are mostly about restraint: who is NOT mailed, and that a run which sent nothing still
 * reports why.
 */
const mocks = vi.hoisted(() => ({
  findMany: vi.fn<(args: unknown) => Promise<unknown[]>>(),
  updateMany: vi.fn<(args: unknown) => Promise<{ count: number }>>(),
  sendEmail: vi.fn<(args: unknown) => Promise<{ id: string }>>(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: { bookingIntent: { findMany: mocks.findMany, updateMany: mocks.updateMany } },
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

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RESEND_API_KEY = 'test-key';
  delete process.env.CRON_SECRET;
  mocks.findMany.mockResolvedValue([]);
  mocks.updateMany.mockResolvedValue({ count: 0 });
  mocks.sendEmail.mockResolvedValue({ id: 'msg_1' });
});

const req = (headers: Record<string, string> = {}) =>
  new Request('https://x/api/cron/booking-sweep', { headers });

describe('auth', () => {
  it('is open when CRON_SECRET is unset, so local dev can curl it', async () => {
    expect((await GET(req())).status).toBe(200);
  });

  it('requires the bearer token when CRON_SECRET is set', async () => {
    process.env.CRON_SECRET = 's3cret';
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req({ authorization: 'Bearer wrong' }))).status).toBe(401);
    expect((await GET(req({ authorization: 'Bearer s3cret' }))).status).toBe(200);
  });

  it('refuses to run with no RESEND_API_KEY rather than reporting an empty success', async () => {
    delete process.env.RESEND_API_KEY;
    const res = await GET(req());
    // Reporting `sent: 0` on missing config is the silent failure this route exists to prevent.
    expect(res.status).toBe(500);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });
});

describe('who gets mailed', () => {
  it('mails the BUYER, not the practitioner, with the token URL', async () => {
    mocks.findMany.mockResolvedValue([intent()]);
    await GET(req());
    const arg = mocks.sendEmail.mock.calls[0]![0] as { to: string; text: string };
    expect(arg.to).toBe('dana@example.com');
    // Addressed by the random publicToken — this URL is going into an inbox.
    expect(arg.text).toContain('/practitioners/sarah/book/tok_abc');
    expect(arg.text).not.toContain('int_1');
  });

  it('keys idempotency on the intent, which is what makes a 15-minute cron safe', async () => {
    mocks.findMany.mockResolvedValue([intent()]);
    await GET(req());
    const arg = mocks.sendEmail.mock.calls[0]![0] as { idempotencyKey: string };
    // Without this the same buyer is mailed every 15 minutes until they pay.
    expect(arg.idempotencyKey).toBe('booking-resume/int_1');
  });

  it('skips a free consultation and says so, rather than skipping silently', async () => {
    mocks.findMany.mockResolvedValue([intent({ offering: { ...intent().offering, isConsult: true } })]);
    const res = await GET(req());
    const body = (await res.json()) as { resume: { sent: number; skipped: number }; skipReasons: Record<string, number> };
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(body.resume.skipped).toBe(1);
    expect(body.skipReasons.free).toBe(1);
  });

  it('skips when payments were never live for that offering', async () => {
    mocks.findMany.mockResolvedValue([intent({ practitioner: { ...intent().practitioner, whopPayoutsEnabled: false } })]);
    const body = (await (await GET(req())).json()) as { skipReasons: Record<string, number> };
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(body.skipReasons['payments-not-live']).toBe(1);
  });

  it('queries only unpaid SCHEDULED intents behind the listing gate', async () => {
    await GET(req());
    const where = (mocks.findMany.mock.calls[0]![0] as { where: Record<string, unknown> }).where;
    expect(where.status).toBe('SCHEDULED');
    expect(where.paidAt).toBeNull();
    // A delisted practitioner's flow page 404s, so a resume link would mail a dead end.
    expect(where.practitioner).toBeTruthy();
  });
});

describe('failure reporting', () => {
  it('keeps sending after one bad address, and reports the failure with a 207', async () => {
    mocks.findMany.mockResolvedValue([intent({ id: 'int_1' }), intent({ id: 'int_2' })]);
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

  it('sends no buyer email for state (a) — they never reached a checkout', async () => {
    mocks.findMany.mockResolvedValue([]);
    mocks.updateMany.mockResolvedValue({ count: 5 });
    await GET(req());
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });
});
