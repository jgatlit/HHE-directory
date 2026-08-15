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
  if (intent.status !== 'SCHEDULED') return { send: false, reason: `status-${intent.status}` };
  if (!intent.scheduledAt) return { send: false, reason: 'no-scheduled-at' };

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
  if (t - intent.scheduledAt.getTime() < RESUME_FLOOR_AFTER_SCHEDULE_MS) {
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
  const greeting = input.firstName ? `Hi ${input.firstName},` : 'Hi,';
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
<p>${greeting}</p>
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
  const subject = `${input.buyerName} booked a time${what}`;

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
