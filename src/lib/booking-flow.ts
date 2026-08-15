export type FlowInputs = {
  /** A resolved, non-empty scheduler URL on the intent's booking link. */
  hasSchedulerUrl: boolean;
  /** §9 — acceptsPayments && practitioner payouts enabled && the offering has a Whop plan id. */
  paymentsLive: boolean;
};

export type FlowShape = {
  /** Step 2 (§5). Skipped only when there is no calendar to send the buyer to. */
  showSchedule: boolean;
  /** Step 3 (§5). */
  showCheckout: boolean;
};

/**
 * Which of §5's steps apply to one intent.
 *
 * Only CAPTURE is unconditional; both middle steps are conditional, which is the whole reason
 * the step map exists:
 *
 *   Free consultation                     1 → 2
 *   Scheduled + paid service              1 → 2 → 3
 *   Subscription / no scheduling          1 → 3
 *   Scheduled service sold off-platform   1 → 2
 *
 * Ordering is SCHEDULE BEFORE CHECKOUT (D4). The booked-without-checkout risk is knowingly
 * accepted — a captured lead with a scheduled consult outweighs the unpaid-hold cost — and is
 * recovered by §10, never by resequencing.
 */
export function flowShape(input: FlowInputs): FlowShape {
  return {
    showSchedule: input.hasSchedulerUrl,
    showCheckout: input.paymentsLive,
  };
}

/**
 * §9 — one stored bit of intent, capability derived. Never store this.
 *
 * Deliberately a three-way AND rather than a status column: `acceptsPayments` is what the
 * practitioner MEANT, and the other two are whether it is currently POSSIBLE. That is what lets
 * a practitioner tick the box before Whop finishes verifying and have the offering go live by
 * itself, with no re-editing.
 */
export function paymentsLive(input: {
  acceptsPayments: boolean;
  practitionerPayoutsEnabled: boolean;
  whopPlanId: string | null;
}): boolean {
  return (
    input.acceptsPayments && input.practitionerPayoutsEnabled && input.whopPlanId !== null
  );
}

/**
 * §8 — how much we trust that scheduling actually happened.
 *
 * `assumed` is a FIRST-CLASS outcome, not a failure: D8 says no external signal is a
 * state-transition guard, so a buyer who advances with neither a provider event nor a
 * self-report click still completes the flow. Recording it honestly is what lets the
 * practitioner see that an unverified booking is unverified.
 */
export type ScheduleSignalValue = 'EVENT' | 'SELF_REPORT' | 'ASSUMED';

export function isValidScheduleSignal(v: string): v is ScheduleSignalValue {
  return v === 'EVENT' || v === 'SELF_REPORT' || v === 'ASSUMED';
}
