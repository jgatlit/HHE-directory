import { paymentsLive } from '@/lib/booking-flow';

/**
 * §10 — abandonment and recovery. The rules, extracted so they have ONE definition and can be
 * tested without a database or a cron.
 *
 * §10 tracks two miss states separately, and the distinction is the whole design:
 *
 *   (a) Captured, never scheduled  → NO buyer email. Surfaces to the practitioner as a lead.
 *   (b) Scheduled, never paid      → resume email to the buyer, and a dashboard row.
 *
 * The timer anchors at CAPTURE, not at scheduling. That is what lets one 15-minute rule cover
 * both: a buyer still choosing a time at minute 15 has not reached SCHEDULED yet, so rule (b)
 * does not match them and rule (a) sends nothing. No second timer is needed.
 */

/** §10's stated interval, measured from capture. */
export const RESUME_AFTER_CAPTURE_MS = 15 * 60 * 1000;

/**
 * §10's implementation floor, measured from the SCHEDULED transition.
 *
 * Without it, a buyer who captures at minute 0 and schedules at minute 14 is emailed "you didn't
 * finish" at minute 15 — sixty seconds after doing the thing. The capture anchor alone cannot
 * express that, because it does not know when they scheduled.
 */
export const RESUME_FLOOR_AFTER_SCHEDULE_MS = 5 * 60 * 1000;

/**
 * How long a PENDING intent waits before it is called ABANDONED.
 *
 * ⚠️ JUDGMENT CALL, flagged rather than buried: the spec restores `ABANDONED` to the status enum
 * but never says what transitions into it. This applies it ONLY to state (a) — captured, never
 * scheduled, and now cold — because that is the state with nothing left to recover.
 *
 * SCHEDULED-but-unpaid intents are deliberately NEVER swept into it, however old they get. §10 is
 * explicit that by then the practitioner holds a name, an email, a phone number and a calendar
 * slot, and that this is "a follow-up, not a loss" — relabelling it as abandoned would file the
 * one state the section exists to rescue under "gone".
 */
export const COLD_LEAD_MS = 7 * 24 * 60 * 60 * 1000;

export type ResumeCandidate = {
  status: string;
  paidAt: Date | null;
  createdAt: Date;
  scheduledAt: Date | null;
  /** Set once §10's resume email has gone out. The exactly-once guard — see the column. */
  resumeEmailSentAt: Date | null;
  /**
   * `whopCheckoutSessionId` — non-null ONLY once the flow actually rendered a checkout for this
   * intent, since the session is minted at that moment and nowhere else.
   *
   * This is what identifies §5's "subscription / no scheduling" cohort (1 → 3). Those intents
   * never pass a scheduler, so their status stays PENDING even after the buyer opens a real Whop
   * checkout and walks away — the textbook state (b). Keying recovery on `status === 'SCHEDULED'`
   * alone left the highest-value path with no recovery at all, and then filed those buyers as
   * ABANDONED under a comment asserting they never reached a checkout.
   */
  reachedCheckout: boolean;
  offering: {
    archived: boolean;
    acceptsPayments: boolean;
    whopPlanId: string | null;
    priceUsdCents: number;
    isConsult: boolean;
  } | null;
  practitionerPayoutsEnabled: boolean;
};

export type ResumeDecision = { send: true } | { send: false; reason: string };

/**
 * Does this intent get §10's resume email?
 *
 * Returns a REASON on refusal rather than a bare false, because the interesting failure here is
 * silent over-sending: every skip is a judgement about someone's inbox, and a sweep that cannot
 * say why it skipped is one nobody can audit.
 *
 * The `payments_live` test delegates to `paymentsLive()` rather than restating its three-way AND,
 * so this can never drift from what the flow page actually renders. A version that re-derived it
 * here would be a second source of truth for the one question that decides whether a checkout
 * step exists at all.
 */
export function resumeDecision(intent: ResumeCandidate, now: Date): ResumeDecision {
  if (intent.paidAt !== null) return { send: false, reason: 'already-paid' };
  // EXACTLY ONCE. Resend's 24h key is a retry guard, not a lifetime one — without this a buyer
  // who decided not to buy is chased daily forever, because nothing else ever makes an unpaid
  // intent stop matching.
  if (intent.resumeEmailSentAt !== null) return { send: false, reason: 'already-sent' };

  // Two routes into state (b), because §5 has two ways to reach a checkout. The scheduled route
  // is the common one; `reachedCheckout` covers the 1 → 3 cohort whose status never leaves
  // PENDING because there is no scheduler step to advance it.
  if (intent.status === 'SCHEDULED') {
    if (!intent.scheduledAt) return { send: false, reason: 'no-scheduled-at' };
  } else if (intent.status === 'PENDING') {
    if (!intent.reachedCheckout) return { send: false, reason: 'never-reached-checkout' };
  } else {
    return { send: false, reason: `status-${intent.status}` };
  }

  const offering = intent.offering;
  // §10: "no abandoned-intent email where there is no checkout to abandon". With no offering
  // there is no step 3 at all — the intent is terminal at SCHEDULED and there is nothing to
  // resume, so mailing them would be inventing an obligation the buyer never had.
  if (!offering) return { send: false, reason: 'no-offering' };
  if (offering.archived) return { send: false, reason: 'offering-archived' };
  // The free-consult path, named explicitly in §10. Also covers any zero-price offering, since a
  // checkout that collects nothing is not a checkout.
  if (offering.isConsult || offering.priceUsdCents <= 0) return { send: false, reason: 'free' };
  if (
    !paymentsLive({
      acceptsPayments: offering.acceptsPayments,
      practitionerPayoutsEnabled: intent.practitionerPayoutsEnabled,
      whopPlanId: offering.whopPlanId,
    })
  ) {
    return { send: false, reason: 'payments-not-live' };
  }

  const t = now.getTime();
  if (t - intent.createdAt.getTime() < RESUME_AFTER_CAPTURE_MS) {
    return { send: false, reason: 'too-soon-since-capture' };
  }
  // Only meaningful on the scheduled route. The 1 → 3 cohort has no scheduling moment, so the
  // capture anchor is the only timer that applies to them.
  if (
    intent.scheduledAt &&
    t - intent.scheduledAt.getTime() < RESUME_FLOOR_AFTER_SCHEDULE_MS
  ) {
    return { send: false, reason: 'too-soon-since-schedule' };
  }
  return { send: true };
}

/**
 * The resume email.
 *
 * TRANSACTIONAL SHAPE, deliberately plain — same rule as the trial-sweep warnings and the
 * magic-link sender. A branded email with a pitch and a styled CTA button landed in Gmail's
 * Promotions tab, and this sender's deliverability was hard-won.
 *
 * It does NOT say "you didn't pay". The buyer scheduled an appointment and may reasonably believe
 * they are finished; the honest framing is that one step remains, not that they failed one.
 */
export function resumeCopy(input: {
  firstName: string;
  practitionerName: string;
  offeringTitle: string;
  resumeUrl: string;
}): { subject: string; text: string; html: string } {
  // firstName comes from `intent.name.split(' ')[0]` — the untrusted public capture form. The
  // HTML greeting is built from the ESCAPED value; every other interpolation in this template was
  // already escaped and this one was not, so a name containing `&` produced invalid markup and a
  // name containing a tag injected live markup into mail sent from the verified domain.
  const greeting = input.firstName ? `Hi ${input.firstName},` : 'Hi,';
  const greetingHtml = input.firstName ? `Hi ${escapeHtml(input.firstName)},` : 'Hi,';
  const subject = `Finish booking ${input.offeringTitle} with ${input.practitionerName}`;

  const text = [
    greeting,
    '',
    `You picked a time with ${input.practitionerName} for ${input.offeringTitle}, but the payment step is still open.`,
    '',
    'Pick up where you left off:',
    input.resumeUrl,
    '',
    `If you have already sorted this out with ${input.practitionerName} directly, you can ignore this.`,
  ].join('\n');

  const html = `<div style="font-family: -apple-system, system-ui, sans-serif; font-size: 15px; line-height: 1.6; color: #1a1a1a;">
<p>${greetingHtml}</p>
<p>You picked a time with ${escapeHtml(input.practitionerName)} for ${escapeHtml(
    input.offeringTitle,
  )}, but the payment step is still open.</p>
<p>Pick up where you left off: <a href="${input.resumeUrl}">${input.resumeUrl}</a></p>
<p style="color:#666;">If you have already sorted this out with ${escapeHtml(
    input.practitionerName,
  )} directly, you can ignore this.</p>
</div>`;

  return { subject, text, html };
}

/**
 * The practitioner's notification that a buyer reached step 2.
 *
 * This exists because the capture email could not tell the truth on its own. It said "they may
 * still be choosing a time", which went stale 22 seconds later on the first real booking this
 * flow took — and nothing anywhere told the practitioner the time had been picked.
 */
export function scheduledNoticeCopy(input: {
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string | null;
  offeringTitle: string | null;
  /** §8 — an unverified booking must be visibly unverified. */
  signal: 'EVENT' | 'SELF_REPORT' | 'ASSUMED';
  profileUrl: string;
  awaitingPayment: boolean;
}): { subject: string; text: string; html: string } {
  const what = input.offeringTitle ? ` · ${input.offeringTitle}` : '';
  // The SUBJECT hedges too, not just the body. It is the part shown in inbox lists, push
  // notifications and lock screens, and often the only part read — so stating "booked a time" as
  // fact for an ASSUMED signal is precisely the dashboard-lying-on-the-calendar's-behalf that the
  // body is careful to avoid.
  const subject =
    input.signal === 'ASSUMED'
      ? `${input.buyerName} may have booked a time${what}`
      : `${input.buyerName} booked a time${what}`;

  // §8: `assumed` means they advanced past the scheduler without a provider event and without
  // clicking "I've booked my time". Saying so plainly is the entire point of recording it —
  // presenting it as a confirmed booking would be the dashboard lying on the calendar's behalf.
  const confidence =
    input.signal === 'ASSUMED'
      ? 'They continued past the calendar without confirming, so this one is worth checking against your own calendar.'
      : input.signal === 'SELF_REPORT'
        ? 'They told us they picked a time — check your calendar for the slot.'
        : 'Their calendar confirmed the booking.';

  const lines = [
    `${input.buyerName} picked a time with you on Natural Health Pros.`,
    '',
    `Email: ${input.buyerEmail}`,
    ...(input.buyerPhone ? [`Phone: ${input.buyerPhone}`] : []),
    ...(input.offeringTitle ? [`For: ${input.offeringTitle}`] : []),
    '',
    confidence,
    ...(input.awaitingPayment
      ? ['', 'They have not completed payment yet. It shows in your dashboard under Bookings.']
      : []),
    '',
    input.profileUrl,
  ];

  const html = `<div style="font-family: -apple-system, system-ui, sans-serif; font-size: 15px; line-height: 1.6; color: #1a1a1a;">
<p>${escapeHtml(input.buyerName)} picked a time with you on Natural Health Pros.</p>
<p><strong>Email:</strong> ${escapeHtml(input.buyerEmail)}${
    input.buyerPhone ? `<br><strong>Phone:</strong> ${escapeHtml(input.buyerPhone)}` : ''
  }${input.offeringTitle ? `<br><strong>For:</strong> ${escapeHtml(input.offeringTitle)}` : ''}</p>
<p>${escapeHtml(confidence)}</p>
${
  input.awaitingPayment
    ? '<p style="color:#666;">They have not completed payment yet. It shows in your dashboard under Bookings.</p>'
    : ''
}
<p><a href="${input.profileUrl}">View your dashboard</a></p>
</div>`;

  return { subject, text: lines.join('\n'), html };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Payment confirmation — to the PRACTITIONER.
 *
 * Nothing was sent on payment before this. `sendEmail` appeared only in the capture lead email,
 * trial-sweep and this sweep, so a successful payment notified neither side. Worse, the Bookings
 * dashboard filters `paidAt: null`, so a paid booking simply VANISHED from it — making "collected"
 * and "deleted" indistinguishable from the practitioner's side.
 */
export function paidNoticeCopy(input: {
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string | null;
  offeringTitle: string | null;
  amountUsdCents: number | null;
  dashboardUrl: string;
}): { subject: string; text: string; html: string } {
  const what = input.offeringTitle ? ` for ${input.offeringTitle}` : '';
  const amount =
    input.amountUsdCents && input.amountUsdCents > 0 ? ` (${formatUsd(input.amountUsdCents)})` : '';
  const subject = `${input.buyerName} paid${what}`;

  const lines = [
    `${input.buyerName} has paid${what}${amount}.`,
    '',
    `Email: ${input.buyerEmail}`,
    ...(input.buyerPhone ? [`Phone: ${input.buyerPhone}`] : []),
    '',
    // Says plainly where the money is, because it does NOT arrive from us — Whop pays out to the
    // practitioner's own connected account, and a practitioner who thinks we hold it will ask.
    'Whop handles the payout to your connected account on their schedule.',
    '',
    input.dashboardUrl,
  ];

  const html = `<div style="font-family: -apple-system, system-ui, sans-serif; font-size: 15px; line-height: 1.6; color: #1a1a1a;">
<p>${escapeHtml(input.buyerName)} has paid${escapeHtml(what)}${escapeHtml(amount)}.</p>
<p><strong>Email:</strong> ${escapeHtml(input.buyerEmail)}${
    input.buyerPhone ? `<br><strong>Phone:</strong> ${escapeHtml(input.buyerPhone)}` : ''
  }</p>
<p style="color:#666;">Whop handles the payout to your connected account on their schedule.</p>
<p><a href="${input.dashboardUrl}">View your dashboard</a></p>
</div>`;

  return { subject, text: lines.join('\n'), html };
}

/**
 * Payment confirmation — to the BUYER.
 *
 * Deliberately NOT called a receipt. The checkout screen used to promise "a receipt is on its way",
 * which referred to Whop's own email — something this codebase neither sends nor has verified.
 * Promising a document we do not control, and cannot confirm exists, is how a buyer ends up
 * emailing the practitioner asking where it is.
 */
export function paidConfirmationCopy(input: {
  firstName: string;
  practitionerName: string;
  offeringTitle: string | null;
  amountUsdCents: number | null;
  bookingUrl: string;
  scheduled: boolean;
}): { subject: string; text: string; html: string } {
  const greeting = input.firstName ? `Hi ${input.firstName},` : 'Hi,';
  const greetingHtml = input.firstName ? `Hi ${escapeHtml(input.firstName)},` : 'Hi,';
  const what = input.offeringTitle ?? 'your booking';
  const amount =
    input.amountUsdCents && input.amountUsdCents > 0 ? ` ${formatUsd(input.amountUsdCents)}` : '';
  const subject = `Payment confirmed — ${what} with ${input.practitionerName}`;

  // A buyer can pay WITHOUT having picked a time (§8, D8: never hard-gate). Saying "you're all
  // set" to that person would be wrong, so the two cases get different closing lines.
  const next = input.scheduled
    ? `${input.practitionerName} has your details and your time.`
    : `If you haven't picked a time yet, you can still do that here:`;

  const lines = [
    greeting,
    '',
    `Your payment${amount} for ${what} with ${input.practitionerName} is confirmed.`,
    '',
    next,
    input.bookingUrl,
  ];

  const html = `<div style="font-family: -apple-system, system-ui, sans-serif; font-size: 15px; line-height: 1.6; color: #1a1a1a;">
<p>${greetingHtml}</p>
<p>Your payment${escapeHtml(amount)} for ${escapeHtml(what)} with ${escapeHtml(
    input.practitionerName,
  )} is confirmed.</p>
<p>${escapeHtml(next)} <a href="${input.bookingUrl}">${input.bookingUrl}</a></p>
</div>`;

  return { subject, text: lines.join('\n'), html };
}

/** Local to this module so the email copy does not depend on a UI formatter. */
function formatUsd(cents: number): string {
  const d = cents / 100;
  return Number.isInteger(d) ? `$${d}` : `$${d.toFixed(2)}`;
}
