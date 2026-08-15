import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

/**
 * The action carries every non-obvious rule in §17.3b — slug scoping, the listing gate, which
 * statuses may advance, and that EVENT is not client-reportable. Asserting `flowShape` returns
 * its input is not coverage of any of that, and two real defects passed a green suite because of
 * it. These assert on the `where` clause, the same way trial-sweep and whop-webhook-v1 do.
 */
const mocks = vi.hoisted(() => ({
  updateMany: vi.fn<(args: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<{ count: number }>>(),
  rateLimit: vi.fn<() => Promise<{ success: boolean; remaining: number; reset: number }>>(),
  revalidatePath: vi.fn(),
  headers: vi.fn(() => new Map<string, string>()),
}));

vi.mock('@/lib/prisma', () => ({ prisma: { bookingIntent: { updateMany: mocks.updateMany } } }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: mocks.rateLimit }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/headers', () => ({ headers: () => ({ get: () => null }) }));

let recordScheduleSignal: (slug: string, token: string, signal: string) => Promise<{ ok: boolean }>;

beforeAll(async () => {
  ({ recordScheduleSignal } = await import(
    '@/app/practitioners/[slug]/book/[token]/actions'
  ));
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rateLimit.mockResolvedValue({ success: true, remaining: 10, reset: 0 });
  mocks.updateMany.mockResolvedValue({ count: 1 });
});

describe('recordScheduleSignal — what may be written', () => {
  it('REFUSES a forged EVENT before touching the database', async () => {
    // The action is public and unauthenticated; the client-side union erases at runtime.
    const r = await recordScheduleSignal('sarah', 'tok_1', 'EVENT');
    expect(r.ok).toBe(false);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it.each(['', 'self_report', 'PAID', 'DROP TABLE'])('refuses %s without a write', async (v) => {
    await recordScheduleSignal('sarah', 'tok_1', v);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it.each(['SELF_REPORT', 'ASSUMED'])('accepts %s and records it', async (signal) => {
    const r = await recordScheduleSignal('sarah', 'tok_1', signal);
    expect(r.ok).toBe(true);
    expect(mocks.updateMany.mock.calls[0]![0].data).toMatchObject({
      status: 'SCHEDULED',
      scheduleSignal: signal,
    });
  });
});

describe('recordScheduleSignal — scoping', () => {
  it('scopes by slug, so one practitioner cannot advance another\'s intent', async () => {
    await recordScheduleSignal('sarah', 'tok_1', 'SELF_REPORT');
    const where = mocks.updateMany.mock.calls[0]![0].where as Record<string, unknown>;
    // Addressed by the RANDOM publicToken, never the cuid primary key: this action is public and
    // unauthenticated, and §10 mails these URLs out.
    expect(where.publicToken).toBe('tok_1');
    expect(where.id).toBeUndefined();
    const practitioner = where.practitioner as Record<string, unknown>;
    expect(practitioner.slug).toBe('sarah');
  });

  // "Unlisted" means absent from directory SEARCH — it never meant the profile is switched off.
  // trial-sweep's warning email promises exactly this: the profile "stays live at its direct
  // link". Gating this action on listedWhere() broke that promise and, incidentally, applied a
  // COMPLETENESS test (bio, city, specialty) to whether someone may be booked.
  it('does NOT apply the listing gate — an unlisted practitioner is still bookable', async () => {
    await recordScheduleSignal('sarah', 'tok_1', 'SELF_REPORT');
    const where = mocks.updateMany.mock.calls[0]![0].where as Record<string, unknown>;
    const practitioner = where.practitioner as Record<string, unknown>;
    // Slug scoping ONLY. listedWhere() contributes displayName/cityId/bio/specialties/OR.
    expect(Object.keys(practitioner)).toEqual(['slug']);
  });

  it('advances PENDING and ABANDONED, never PAID', async () => {
    await recordScheduleSignal('sarah', 'tok_1', 'SELF_REPORT');
    const where = mocks.updateMany.mock.calls[0]![0].where as { status: { in: string[] } };
    // ABANDONED is included deliberately: §10's resume email targets exactly those intents, so
    // excluding it meant a recovered booking could never be recorded.
    expect(where.status.in).toEqual(expect.arrayContaining(['PENDING', 'ABANDONED']));
    expect(where.status.in).not.toContain('PAID');
    expect(where.status.in).not.toContain('SCHEDULED');
  });
});

describe('recordScheduleSignal — it must never block the buyer (D8)', () => {
  it('reports ok when the row was already advanced, rather than erroring', async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    const r = await recordScheduleSignal('sarah', 'tok_1', 'ASSUMED');
    expect(r.ok).toBe(true);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('is throttled — the sibling capture action is, and this one writes too', async () => {
    mocks.rateLimit.mockResolvedValue({ success: false, remaining: 0, reset: 0 });
    const r = await recordScheduleSignal('sarah', 'tok_1', 'SELF_REPORT');
    expect(r.ok).toBe(false);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it('records an observation time, not an appointment time', async () => {
    await recordScheduleSignal('sarah', 'tok_1', 'SELF_REPORT');
    const data = mocks.updateMany.mock.calls[0]![0].data as { scheduledAt: Date };
    // We do not know when the appointment is and must not imply we do (§18).
    expect(data.scheduledAt).toBeInstanceOf(Date);
  });
});
