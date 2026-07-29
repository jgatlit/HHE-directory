import { describe, it, expect } from 'vitest';
import {
  isListed,
  isProfileComplete,
  profileCompletenessSignals,
} from '@/lib/practitioner-indexer';

/**
 * isListed() converts billing + trial + profile state into public directory visibility.
 * A regression here either hides someone who is paying, or keeps showing someone who
 * stopped — see docs/superpowers/specs/2026-07-16-pilot-trial-design.md for the trial-clock
 * design this encodes.
 */

type GateInput = Parameters<typeof isListed>[0];

const DAY_MS = 1000 * 60 * 60 * 24;
const FAR_FUTURE = new Date(Date.now() + 30 * DAY_MS);
const FAR_PAST = new Date(Date.now() - 30 * DAY_MS);
// Clearly-separated offsets, not the exact Date.now() instant, so the boundary
// assertion can't flake on execution timing.
const NEAR_FUTURE = new Date(Date.now() + 5000);
const NEAR_PAST = new Date(Date.now() - 5000);

function makePractitioner(overrides: Partial<GateInput> = {}): GateInput {
  return {
    displayName: 'Jane Doe',
    cityId: 'city_atlanta',
    bio: 'A bio that clears the twenty-character minimum easily.',
    specialties: [{ specialtyId: 'spec_acupuncture' }],
    subscriptionStatus: 'NONE',
    trialEndsAt: null,
    user: { role: 'CLIENT' },
    ...overrides,
  };
}

describe('isListed — trial clock', () => {
  // trialEndsAt: null is reachable only by seeding, never by real onboarding — it's what
  // keeps operator-seeded practitioners listed. All production practitioners are here today.
  it('lists a pre-trial practitioner (trialEndsAt: null)', () => {
    expect(isListed(makePractitioner({ trialEndsAt: null }))).toBe(true);
  });

  it('lists a practitioner mid-trial (trialEndsAt in the future)', () => {
    expect(isListed(makePractitioner({ trialEndsAt: FAR_FUTURE }))).toBe(true);
  });

  it('delists a practitioner whose trial expired with no subscription', () => {
    expect(isListed(makePractitioner({ trialEndsAt: FAR_PAST }))).toBe(false);
  });

  it('boundary: still listed a few seconds before trial end', () => {
    expect(isListed(makePractitioner({ trialEndsAt: NEAR_FUTURE }))).toBe(true);
  });

  it('boundary: already delisted a few seconds after trial end', () => {
    expect(isListed(makePractitioner({ trialEndsAt: NEAR_PAST }))).toBe(false);
  });
});

describe('isListed — subscription status', () => {
  it('lists an ACTIVE subscriber even past trial end', () => {
    expect(
      isListed(makePractitioner({ subscriptionStatus: 'ACTIVE', trialEndsAt: FAR_PAST })),
    ).toBe(true);
  });

  it("stays listed while PAST_DUE, during Whop's dunning grace window", () => {
    // Whop's dunning window: a failed card must not delist someone instantly.
    expect(
      isListed(makePractitioner({ subscriptionStatus: 'PAST_DUE', trialEndsAt: FAR_PAST })),
    ).toBe(true);
  });

  it('delists a CANCELED subscriber whose trial has expired', () => {
    expect(
      isListed(makePractitioner({ subscriptionStatus: 'CANCELED', trialEndsAt: FAR_PAST })),
    ).toBe(false);
  });

  it('delists a practitioner with no subscription (NONE) whose trial has expired', () => {
    expect(
      isListed(makePractitioner({ subscriptionStatus: 'NONE', trialEndsAt: FAR_PAST })),
    ).toBe(false);
  });
});

describe('isListed — profile completeness gate', () => {
  it('is not listed with an incomplete profile even when ACTIVE', () => {
    // Billing entitles a practitioner to a listing; it does not produce one.
    expect(isListed(makePractitioner({ subscriptionStatus: 'ACTIVE', bio: null }))).toBe(false);
  });

  it('is not listed with a complete profile once the trial expires and there is no subscription', () => {
    // Both halves of the gate — completeness AND billing/trial — are required.
    expect(
      isListed(makePractitioner({ trialEndsAt: FAR_PAST, subscriptionStatus: 'NONE' })),
    ).toBe(false);
  });
});

describe('profileCompletenessSignals / isProfileComplete', () => {
  const complete = {
    displayName: 'Jane Doe',
    cityId: 'city_atlanta',
    bio: 'A bio that clears the twenty-character minimum easily.',
    specialties: [{ specialtyId: 'spec_acupuncture' }],
  };

  it('reports complete when all four signals are present', () => {
    expect(isProfileComplete(complete)).toBe(true);
    expect(profileCompletenessSignals(complete)).toEqual({
      hasDisplayName: true,
      hasCity: true,
      hasBio: true,
      hasSpecialty: true,
    });
  });

  it('requires a non-blank displayName', () => {
    expect(isProfileComplete({ ...complete, displayName: null })).toBe(false);
    expect(isProfileComplete({ ...complete, displayName: '   ' })).toBe(false);
  });

  it('requires a cityId', () => {
    expect(isProfileComplete({ ...complete, cityId: null })).toBe(false);
  });

  it('requires a bio of at least twenty characters', () => {
    expect(isProfileComplete({ ...complete, bio: null })).toBe(false);
    expect(isProfileComplete({ ...complete, bio: 'too short' })).toBe(false);
  });

  it('requires at least one specialty', () => {
    expect(isProfileComplete({ ...complete, specialties: [] })).toBe(false);
  });
});

describe('isListed — admin exemption', () => {
  it('lists an ADMIN regardless of expired trial and no subscription', () => {
    // Staff, not customers — read server-side from User.role, not the viewer's session.
    expect(
      isListed(
        makePractitioner({
          user: { role: 'ADMIN' },
          trialEndsAt: FAR_PAST,
          subscriptionStatus: 'NONE',
        }),
      ),
    ).toBe(true);
  });

  it('the ADMIN exemption does not bypass profile completeness', () => {
    expect(isListed(makePractitioner({ user: { role: 'ADMIN' }, bio: null }))).toBe(false);
  });
});
