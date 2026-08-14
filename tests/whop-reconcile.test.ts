import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import type { NextRequest } from 'next/server';

type Row = {
  id: string;
  slug: string;
  whopIdentityProfileId: string | null;
  whopPayoutAccountId: string | null;
  whopPayoutStatus: string;
  whopPayoutsEnabled: boolean;
};

const mocks = vi.hoisted(() => ({
  findMany: vi.fn<() => Promise<Row[]>>(),
  update: vi.fn<(args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>>(),
  getIdentityProfile: vi.fn(),
  getPayoutStatus: vi.fn(),
  isWhopPlatformsReady: vi.fn<() => boolean>(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: { practitioner: { findMany: mocks.findMany, update: mocks.update } },
}));

vi.mock('@/lib/whop', () => ({
  getIdentityProfile: mocks.getIdentityProfile,
  getPayoutStatus: mocks.getPayoutStatus,
  isWhopPlatformsReady: mocks.isWhopPlatformsReady,
}));

// Imported inside beforeAll, not at module top level: a top-level await here is valid for
// vitest but trips tsc under this tsconfig's module target. Mirrors trial-sweep.test.ts.
let GET: (req: NextRequest) => Promise<Response>;

beforeAll(async () => {
  ({ GET } = await import('@/app/api/cron/whop-reconcile/route'));
});

function req(auth?: string): NextRequest {
  return new Request('https://example.test/api/cron/whop-reconcile', {
    headers: auth ? { authorization: auth } : {},
  }) as unknown as NextRequest;
}

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: 'prac_1',
    slug: 'sarah',
    whopIdentityProfileId: 'idpf_L366QzEEVUnVH',
    whopPayoutAccountId: null,
    whopPayoutStatus: 'not_started',
    whopPayoutsEnabled: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.CRON_SECRET;
  mocks.isWhopPlatformsReady.mockReturnValue(true);
  mocks.update.mockResolvedValue({});
  mocks.findMany.mockResolvedValue([]);
});

describe('whop-reconcile — authorization', () => {
  it('rejects a wrong bearer when CRON_SECRET is set', async () => {
    process.env.CRON_SECRET = 's3cret';
    const res = await GET(req('Bearer wrong'));
    expect(res.status).toBe(401);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it('accepts the correct bearer', async () => {
    process.env.CRON_SECRET = 's3cret';
    const res = await GET(req('Bearer s3cret'));
    expect(res.status).toBe(200);
  });

  it('is OPEN when CRON_SECRET is unset — pins the branch rather than leaving it undocumented', async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(mocks.findMany).toHaveBeenCalled();
  });
});

describe('whop-reconcile — the payout gate', () => {
  // THE REGRESSION GUARD. A parent-company API key under-reports `payouts_enabled`: Whop's own
  // identity_profile.updated for idpf_f9VEKuIiqGPc2 carried `payouts_enabled: true`, while GET
  // /identity_profiles returns `false` for that same profile. Gating on the polled boolean is
  // what made this sweep structurally unable to open the gate it exists to open.
  it('OPENS the gate on approved + connected even when the polled payouts_enabled is false', async () => {
    mocks.findMany.mockResolvedValue([row()]);
    mocks.getIdentityProfile.mockResolvedValue({
      status: 'approved',
      payoutStatus: 'connected',
      payoutsEnabled: false,
    });

    const res = await GET(req());
    const body = await res.json();

    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'prac_1' },
        data: expect.objectContaining({ whopPayoutsEnabled: true }),
      }),
    );
    expect(body.corrected).toBeGreaterThan(0);
  });

  it('does NOT open the gate when the profile is approved but not yet connected', async () => {
    mocks.findMany.mockResolvedValue([row()]);
    mocks.getIdentityProfile.mockResolvedValue({
      status: 'approved',
      payoutStatus: 'pending_verification',
      payoutsEnabled: false,
    });

    await GET(req());

    const data = mocks.update.mock.calls[0]?.[0]?.data ?? {};
    expect(data).not.toHaveProperty('whopPayoutsEnabled');
  });

  it('is ONE-WAY: never closes a gate that is already open', async () => {
    mocks.findMany.mockResolvedValue([row({ whopPayoutsEnabled: true, whopPayoutStatus: 'connected' })]);
    mocks.getIdentityProfile.mockResolvedValue({
      status: 'approved',
      payoutStatus: 'connected',
      payoutsEnabled: false,
    });

    await GET(req());

    for (const call of mocks.update.mock.calls) {
      expect(call[0].data).not.toHaveProperty('whopPayoutsEnabled');
    }
  });
});

describe('whop-reconcile — honest reporting', () => {
  it('does NOT report drift that was never persisted', async () => {
    mocks.findMany.mockResolvedValue([row()]);
    mocks.getIdentityProfile.mockResolvedValue({
      status: 'approved',
      payoutStatus: 'connected',
      payoutsEnabled: false,
    });
    mocks.update.mockRejectedValue(new Error('P2002 unique constraint'));

    const res = await GET(req());
    const body = await res.json();

    expect(body.corrected).toBe(0);
    expect(body.drift).toEqual([]);
    expect(body.errors.join(' ')).toContain('P2002');
  });

  it('returns 207 when any account failed, so a fully-failed sweep cannot read as healthy', async () => {
    mocks.findMany.mockResolvedValue([row()]);
    mocks.getIdentityProfile.mockRejectedValue(new Error('401 unauthorized'));

    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(207);
    expect(body.ok).toBe(false);
    expect(body.errors).toHaveLength(1);
  });

  it('returns 200 ok:true only on a genuinely clean run', async () => {
    mocks.findMany.mockResolvedValue([row({ whopPayoutStatus: 'connected', whopPayoutsEnabled: true })]);
    mocks.getIdentityProfile.mockResolvedValue({
      status: 'approved',
      payoutStatus: 'connected',
      payoutsEnabled: true,
    });

    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.errors).toEqual([]);
  });

  it('reports an unresolvable identity profile instead of counting it as verified', async () => {
    mocks.findMany.mockResolvedValue([row()]);
    mocks.getIdentityProfile.mockResolvedValue(null);

    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(207);
    expect(body.errors.join(' ')).toContain('no Whop resource resolved');
  });

  it('falls back to the payout account when the identity profile does not resolve', async () => {
    mocks.findMany.mockResolvedValue([
      row({ whopPayoutAccountId: 'poact_SeAGBkatzxjJ' }),
    ]);
    mocks.getIdentityProfile.mockResolvedValue(null);
    mocks.getPayoutStatus.mockResolvedValue({ status: 'connected' });

    await GET(req());

    expect(mocks.getPayoutStatus).toHaveBeenCalledWith('poact_SeAGBkatzxjJ');
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ whopPayoutStatus: 'connected' }) }),
    );
  });

  it('flags a connected account with no Whop resource ids as unpollable, not clean', async () => {
    mocks.findMany.mockResolvedValue([
      row({ whopIdentityProfileId: null, whopPayoutAccountId: null }),
    ]);

    const res = await GET(req());
    const body = await res.json();

    expect(body.unpollable).toEqual(['sarah']);
    expect(res.status).toBe(207);
  });
});
