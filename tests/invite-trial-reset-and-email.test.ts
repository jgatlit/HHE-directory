import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Two operator capabilities added 2026-08-18:
 *   - resending an invitation RESETS the recipient's pilot clock
 *   - an admin can CORRECT the registered email in place
 *
 * The assertions concentrate on the two ways each one can quietly do damage: resurrecting a
 * retired row, and starting a paywall clock nobody asked to start.
 */

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  practitionerUpdate: vi.fn(),
  indexPractitioner: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique },
    practitioner: { update: mocks.practitionerUpdate },
  },
}));

const RETIREMENT_SENTINEL = new Date('1971-01-01T00:00:00.000Z');
const TRIAL_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * A faithful transcription of `resetTrialForEmail` from src/app/admin/invites/actions.ts.
 *
 * It is a module-private helper inside a `'use server'` file whose import graph pulls in
 * next/navigation's redirect and the whole auth stack, so it cannot be imported here. The
 * mirror is the honest trade — and it is a REAL risk, so
 * tests/server-action-reachability-style source assertions at the bottom pin the production
 * copy's guards so the two cannot silently diverge.
 */
async function resetTrialForEmail(email: string, clockEnabled: boolean): Promise<void> {
  const user = await mocks.userFindUnique({ where: { email } });
  const practitioner = user?.practitioner;
  if (!practitioner) return;
  const isRetired =
    practitioner.trialEndsAt !== null && practitioner.trialEndsAt <= RETIREMENT_SENTINEL;
  if (isRetired) return;
  if (practitioner.trialEndsAt === null && !clockEnabled) return;
  await mocks.practitionerUpdate({
    where: { id: practitioner.id },
    data: { trialEndsAt: new Date(Date.now() + TRIAL_MS) },
  });
  await mocks.indexPractitioner(practitioner.id);
}

const withPractitioner = (trialEndsAt: Date | null, id = 'prac_1') => ({
  practitioner: { id, trialEndsAt },
});

beforeEach(() => {
  mocks.userFindUnique.mockReset();
  mocks.practitionerUpdate.mockReset().mockResolvedValue({});
  mocks.indexPractitioner.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

describe('resend → trial reset', () => {
  it('resets a RUNNING clock to a fresh 90 days', async () => {
    const soon = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    mocks.userFindUnique.mockResolvedValue(withPractitioner(soon));

    await resetTrialForEmail('a@example.com', false);

    expect(mocks.practitionerUpdate).toHaveBeenCalledTimes(1);
    const written = mocks.practitionerUpdate.mock.calls[0]![0].data.trialEndsAt as Date;
    expect(written.getTime()).toBeGreaterThan(soon.getTime());
  });

  it('resets a LAPSED clock — the whole point, a trial that burned down while locked out', async () => {
    mocks.userFindUnique.mockResolvedValue(
      withPractitioner(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
    );

    await resetTrialForEmail('a@example.com', false);

    const written = mocks.practitionerUpdate.mock.calls[0]![0].data.trialEndsAt as Date;
    expect(written.getTime()).toBeGreaterThan(Date.now());
  });

  it('REFUSES to resurrect a retired row (epoch sentinel)', async () => {
    // sarah-schindler: a duplicate whose mailbox is confirmed dead. Un-retiring it puts a
    // lead-swallowing profile back into circulation — retirement is not a lapsed trial.
    mocks.userFindUnique.mockResolvedValue(withPractitioner(new Date('1970-01-01T00:00:00.000Z')));

    await resetTrialForEmail('dead@example.com', true);

    expect(mocks.practitionerUpdate, 'a retired row was un-retired').not.toHaveBeenCalled();
    expect(mocks.indexPractitioner).not.toHaveBeenCalled();
  });

  it('does NOT start a clock that does not exist while the pilot clock is off', async () => {
    // All 12 pilots are trialEndsAt: null. Starting their countdown as a side effect of
    // "resend invite" would begin the paywall for the cohort with nobody deciding to.
    mocks.userFindUnique.mockResolvedValue(withPractitioner(null));

    await resetTrialForEmail('pilot@example.com', false);

    expect(mocks.practitionerUpdate).not.toHaveBeenCalled();
  });

  it('DOES start a clock from null once PILOT_TRIAL_CLOCK_ENABLED is on', async () => {
    mocks.userFindUnique.mockResolvedValue(withPractitioner(null));

    await resetTrialForEmail('pilot@example.com', true);

    expect(mocks.practitionerUpdate).toHaveBeenCalledTimes(1);
  });

  it('is a no-op for an invitation with no practitioner behind it', async () => {
    mocks.userFindUnique.mockResolvedValue(null);
    await resetTrialForEmail('nobody@example.com', true);
    expect(mocks.practitionerUpdate).not.toHaveBeenCalled();
  });

  it('reindexes after a reset — Typesense is push-based', async () => {
    mocks.userFindUnique.mockResolvedValue(withPractitioner(new Date(Date.now() + 1000)));
    await resetTrialForEmail('a@example.com', false);
    expect(mocks.indexPractitioner).toHaveBeenCalledWith('prac_1');
  });
});

describe('the production helper still carries both guards', () => {
  // Pins the real source so the mirror above cannot drift away from it unnoticed.
  const src = () =>
    require('node:fs').readFileSync(
      require('node:path').join(__dirname, '..', 'src', 'app', 'admin', 'invites', 'actions.ts'),
      'utf8',
    );

  it('guards the retirement sentinel', () => {
    expect(src()).toMatch(/trialEndsAt <= RETIREMENT_SENTINEL/);
  });

  it('guards against creating a clock while PILOT_TRIAL_CLOCK_ENABLED is off', () => {
    expect(src()).toMatch(/trialEndsAt === null && !clockEnabled/);
  });

  it('resets only AFTER a confirmed send', () => {
    const s = src();
    const sendIdx = s.indexOf("error=send-failed');\n  }\n\n  // Operator rule");
    expect(sendIdx, 'the reset moved above the send-failure guard').toBeGreaterThan(-1);
  });

  it('email correction refuses a collision instead of merging accounts', () => {
    expect(src()).toMatch(/if \(collision\) redirect\('\/admin\/invites\?error=email-taken'\)/);
  });

  it('email correction moves the invitation AND the user together, in a transaction', () => {
    const s = src();
    expect(s).toMatch(/\$transaction/);
    expect(s).toMatch(/tx\.invitation\.update/);
    expect(s).toMatch(/tx\.user\.update/);
  });
});
