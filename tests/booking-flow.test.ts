import { describe, it, expect } from 'vitest';
import { flowShape, paymentsLive, isValidScheduleSignal } from '@/lib/booking-flow';

describe('flowShape — §5 step map', () => {
  // The four rows of §5's table, asserted directly. Only CAPTURE is unconditional; both middle
  // steps are conditional, which is the whole reason the map exists.
  it('free consultation → schedule only (1 → 2)', () => {
    expect(flowShape({ hasSchedulerUrl: true, paymentsLive: false })).toEqual({
      showSchedule: true,
      showCheckout: false,
    });
  });

  it('scheduled + paid service → both (1 → 2 → 3)', () => {
    expect(flowShape({ hasSchedulerUrl: true, paymentsLive: true })).toEqual({
      showSchedule: true,
      showCheckout: true,
    });
  });

  it('subscription / no scheduling → checkout only (1 → 3)', () => {
    expect(flowShape({ hasSchedulerUrl: false, paymentsLive: true })).toEqual({
      showSchedule: false,
      showCheckout: true,
    });
  });

  it('informational only → neither', () => {
    expect(flowShape({ hasSchedulerUrl: false, paymentsLive: false })).toEqual({
      showSchedule: false,
      showCheckout: false,
    });
  });
});

describe('paymentsLive — §9, one bit of intent and two of capability', () => {
  const live = { acceptsPayments: true, practitionerPayoutsEnabled: true, whopPlanId: 'plan_x' };

  it('is true only when all three hold', () => {
    expect(paymentsLive(live)).toBe(true);
  });

  it.each([
    ['the practitioner never opted in', { acceptsPayments: false }],
    ['Whop payouts are not enabled', { practitionerPayoutsEnabled: false }],
    ['no plan id exists yet', { whopPlanId: null }],
  ])('is false when %s', (_why, override) => {
    expect(paymentsLive({ ...live, ...override })).toBe(false);
  });

  // THE REGRESSION GUARD FOR §9's CORE RULE: "never render a Buy CTA that cannot transact."
  // The intent bit alone must never open checkout — that is what lets a practitioner tick the
  // box while Whop is still verifying and have it switch on by itself.
  it('intent alone does NOT make payments live', () => {
    expect(
      paymentsLive({
        acceptsPayments: true,
        practitionerPayoutsEnabled: false,
        whopPlanId: null,
      }),
    ).toBe(false);
  });

  // Production shape on the day this shipped: Sarah has payouts enabled and a published
  // offering, but never ticked acceptsPayments — so checkout stays off until she opts in.
  it('matches the live production shape (payouts on, plan minted, intent off)', () => {
    expect(
      paymentsLive({
        acceptsPayments: false,
        practitionerPayoutsEnabled: true,
        whopPlanId: 'plan_e9mowX3Dg6lbs',
      }),
    ).toBe(false);
  });
});

describe('isValidScheduleSignal', () => {
  it('accepts the three §8 values', () => {
    for (const v of ['EVENT', 'SELF_REPORT', 'ASSUMED']) {
      expect(isValidScheduleSignal(v)).toBe(true);
    }
  });

  // The signal arrives from an unauthenticated client, so an unknown value must be refused
  // rather than written — a Prisma enum write of a bad value would throw inside the action.
  it('refuses anything else, including lowercase and injection-ish input', () => {
    for (const v of ['', 'event', 'PAID', 'DROP TABLE', 'ASSUMED ']) {
      expect(isValidScheduleSignal(v)).toBe(false);
    }
  });
});
