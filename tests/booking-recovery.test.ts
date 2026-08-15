import { describe, it, expect } from 'vitest';
import {
  COLD_LEAD_MS,
  RESUME_AFTER_CAPTURE_MS,
  RESUME_FLOOR_AFTER_SCHEDULE_MS,
  resumeCopy,
  resumeDecision,
  scheduledNoticeCopy,
  type ResumeCandidate,
} from '@/lib/booking-recovery';

const NOW = new Date('2026-08-15T12:00:00.000Z');
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000);

function candidate(over: Partial<ResumeCandidate> = {}): ResumeCandidate {
  return {
    status: 'SCHEDULED',
    paidAt: null,
    createdAt: minutesAgo(60),
    scheduledAt: minutesAgo(30),
    resumeEmailSentAt: null,
    reachedCheckout: false,
    practitionerPayoutsEnabled: true,
    offering: {
      archived: false,
      acceptsPayments: true,
      whopPlanId: 'plan_1',
      priceUsdCents: 5500,
      isConsult: false,
    },
    ...over,
  };
}

describe('resumeDecision — who gets §10’s resume email', () => {
  it('sends for the state the whole section exists for: scheduled, unpaid, payable', () => {
    expect(resumeDecision(candidate(), NOW)).toEqual({ send: true });
  });

  // §10: "no abandoned-intent email where there is no checkout to abandon". Each of these is a
  // buyer who owes nothing — mailing them would invent an obligation they never had.
  it.each([
    ['a free consultation', { offering: { ...candidate().offering!, isConsult: true } }, 'free'],
    ['a zero-price offering', { offering: { ...candidate().offering!, priceUsdCents: 0 } }, 'free'],
    [
      'an off-platform sale (acceptsPayments false)',
      { offering: { ...candidate().offering!, acceptsPayments: false } },
      'payments-not-live',
    ],
    [
      'a practitioner whose payouts are not enabled',
      { practitionerPayoutsEnabled: false },
      'payments-not-live',
    ],
    [
      'an offering with no Whop plan',
      { offering: { ...candidate().offering!, whopPlanId: null } },
      'payments-not-live',
    ],
    ['an offering archived after capture', { offering: { ...candidate().offering!, archived: true } }, 'offering-archived'],
    ['no offering at all', { offering: null }, 'no-offering'],
  ])('never emails %s', (_label, over, reason) => {
    expect(resumeDecision(candidate(over as Partial<ResumeCandidate>), NOW)).toMatchObject({
      send: false,
      reason,
    });
  });

  // The timer anchors at CAPTURE, which is what lets one rule cover both miss states: a buyer
  // still choosing a time at minute 15 has not reached SCHEDULED, so state (b) does not match.
  it('does not email before 15 minutes have passed since capture', () => {
    const r = resumeDecision(
      candidate({ createdAt: minutesAgo(14), scheduledAt: minutesAgo(13) }),
      NOW,
    );
    expect(r).toMatchObject({ send: false, reason: 'too-soon-since-capture' });
  });

  // §10's implementation floor. Without it, capture at 0 + schedule at 14 = "you didn't finish"
  // sixty seconds after they finished.
  it('does not email someone who scheduled a moment ago, even if capture was long ago', () => {
    const r = resumeDecision(candidate({ createdAt: minutesAgo(60), scheduledAt: minutesAgo(1) }), NOW);
    expect(r).toMatchObject({ send: false, reason: 'too-soon-since-schedule' });
  });

  it('emails once BOTH the capture interval and the schedule floor have elapsed', () => {
    const justPast = new Date(
      NOW.getTime() - RESUME_FLOOR_AFTER_SCHEDULE_MS - 1000,
    );
    const r = resumeDecision(
      candidate({
        createdAt: new Date(NOW.getTime() - RESUME_AFTER_CAPTURE_MS - 1000),
        scheduledAt: justPast,
      }),
      NOW,
    );
    expect(r).toEqual({ send: true });
  });

  // State (a) gets NO buyer email — it is a lead, not an abandoned checkout.
  it.each(['PENDING', 'ABANDONED', 'PAID'])('never emails a %s intent that never reached checkout', (status) => {
    const r = resumeDecision(candidate({ status }), NOW);
    expect(r.send).toBe(false);
  });

  // §5's "subscription / no scheduling" row (1 → 3). These buyers never pass a scheduler, so
  // their status stays PENDING even after they open a real Whop checkout and walk away — the
  // textbook state (b). Keying on status alone left the highest-value path with NO recovery, and
  // then filed those buyers as ABANDONED claiming they never reached a checkout.
  it('emails the no-scheduler cohort, whose status never leaves PENDING', () => {
    const r = resumeDecision(
      candidate({ status: 'PENDING', scheduledAt: null, reachedCheckout: true }),
      NOW,
    );
    expect(r).toEqual({ send: true });
  });

  it('does not email a PENDING intent that never got as far as a checkout', () => {
    const r = resumeDecision(
      candidate({ status: 'PENDING', scheduledAt: null, reachedCheckout: false }),
      NOW,
    );
    expect(r).toMatchObject({ send: false, reason: 'never-reached-checkout' });
  });

  // Resend's key de-duplicates for 24h and nothing else ever removes an unpaid intent from the
  // candidate set — so without this marker a buyer who decided not to buy is chased DAILY,
  // forever, from a sending domain whose deliverability was hard-won.
  it('never sends a second resume email, however long the intent stays unpaid', () => {
    const r = resumeDecision(candidate({ resumeEmailSentAt: minutesAgo(60 * 24 * 30) }), NOW);
    expect(r).toMatchObject({ send: false, reason: 'already-sent' });
  });

  it('never emails an intent the webhook already marked paid, whatever its status says', () => {
    // status and paidAt can disagree for a moment; paidAt is the authority.
    const r = resumeDecision(candidate({ paidAt: NOW }), NOW);
    expect(r).toMatchObject({ send: false, reason: 'already-paid' });
  });

  it('refuses rather than throwing when SCHEDULED has no scheduledAt', () => {
    expect(resumeDecision(candidate({ scheduledAt: null }), NOW)).toMatchObject({ send: false, reason: 'no-scheduled-at', });
  });
});

describe('the §10 constants say what they mean', () => {
  it('anchors at 15 minutes from capture, per the spec', () => {
    expect(RESUME_AFTER_CAPTURE_MS).toBe(15 * 60 * 1000);
  });
  it('keeps a floor after the SCHEDULED transition that is shorter than the capture window', () => {
    // If the floor exceeded the capture window it would silently become the only rule.
    expect(RESUME_FLOOR_AFTER_SCHEDULE_MS).toBeGreaterThan(0);
    expect(RESUME_FLOOR_AFTER_SCHEDULE_MS).toBeLessThan(RESUME_AFTER_CAPTURE_MS);
  });
  it('waits far longer before calling a lead cold than before nudging a booking', () => {
    expect(COLD_LEAD_MS).toBeGreaterThan(RESUME_AFTER_CAPTURE_MS * 100);
  });
});

describe('resumeCopy', () => {
  const copy = resumeCopy({
    firstName: 'Dana',
    practitionerName: 'Sarah Schindler',
    offeringTitle: 'Root Cause Release',
    resumeUrl: 'https://naturalhealthpros.com/practitioners/sarah/book/abc123',
  });

  it('carries the resume link in both parts, or the email is undeliverable on its own promise', () => {
    expect(copy.text).toContain('https://naturalhealthpros.com/practitioners/sarah/book/abc123');
    expect(copy.html).toContain('https://naturalhealthpros.com/practitioners/sarah/book/abc123');
  });

  it('names the practitioner and the offering in the subject, so it is recognisable in a list', () => {
    expect(copy.subject).toContain('Sarah Schindler');
    expect(copy.subject).toContain('Root Cause Release');
  });

  it('does not accuse the buyer of failing to pay — they booked, one step remains', () => {
    expect(copy.text.toLowerCase()).not.toContain('failed');
    expect(copy.text).toContain('still open');
  });

  it('escapes the buyer-supplied first name in the HTML part', () => {
    // firstName comes from the untrusted public capture form via name.split(' ')[0]. Every other
    // field in this template was escaped and this one was not.
    const c = resumeCopy({
      firstName: '<b>Tom</b> & Jerry',
      practitionerName: 'X',
      offeringTitle: 'Y',
      resumeUrl: 'https://e.com/z',
    });
    expect(c.html).not.toContain('<b>Tom</b>');
    expect(c.html).toContain('&lt;b&gt;');
    expect(c.html).toContain('&amp;');
  });

  it('degrades to a bare greeting rather than "Hi ," when there is no first name', () => {
    const c = resumeCopy({
      firstName: '',
      practitionerName: 'X',
      offeringTitle: 'Y',
      resumeUrl: 'https://e.com/z',
    });
    expect(c.text).not.toContain('Hi ,');
  });
});

describe('scheduledNoticeCopy — §8’s visible uncertainty', () => {
  const base = {
    buyerName: 'Dana Reed',
    buyerEmail: 'dana@example.com',
    buyerPhone: null,
    offeringTitle: 'Root Cause Release',
    profileUrl: 'https://naturalhealthpros.com/practitioners/sarah/edit',
    awaitingPayment: true,
  } as const;

  it('tells the practitioner an ASSUMED booking is unconfirmed', () => {
    const c = scheduledNoticeCopy({ ...base, signal: 'ASSUMED' });
    expect(c.text).toContain('without confirming');
  });

  // The SUBJECT is what appears in inbox lists, push notifications and lock screens, and is often
  // the only part read — so it has to hedge too, not just the body.
  it('hedges in the SUBJECT for an ASSUMED signal, not only in the body', () => {
    const assumed = scheduledNoticeCopy({ ...base, signal: 'ASSUMED' });
    const reported = scheduledNoticeCopy({ ...base, signal: 'SELF_REPORT' });
    expect(assumed.subject).toContain('may have booked');
    expect(reported.subject).not.toContain('may have');
    expect(reported.subject).toContain('booked a time');
  });

  it('does not describe a SELF_REPORT as calendar-confirmed', () => {
    const c = scheduledNoticeCopy({ ...base, signal: 'SELF_REPORT' });
    expect(c.text).not.toContain('calendar confirmed');
    expect(c.text).toContain('They told us');
  });

  // Claiming money is owed on a free consult would send practitioners chasing payments their own
  // configuration never asked for.
  it('only mentions outstanding payment when a checkout actually existed', () => {
    const owed = scheduledNoticeCopy({ ...base, signal: 'SELF_REPORT', awaitingPayment: true });
    const free = scheduledNoticeCopy({ ...base, signal: 'SELF_REPORT', awaitingPayment: false });
    expect(owed.text).toContain('not completed payment');
    expect(free.text).not.toContain('not completed payment');
    expect(free.html).not.toContain('not completed payment');
  });

  it('escapes buyer-supplied text in the HTML part', () => {
    const c = scheduledNoticeCopy({
      ...base,
      buyerName: '<script>alert(1)</script>',
      signal: 'ASSUMED',
    });
    expect(c.html).not.toContain('<script>');
    expect(c.html).toContain('&lt;script&gt;');
  });
});

/**
 * Permanence drives whether the sweep RECORDS a refusal. Getting it wrong is silent in both
 * directions: mark a transient refusal permanent and that buyer is never recovered; leave a
 * permanent one unmarked and it matches forever, head-of-line blocking the capped query.
 */
describe('resumeDecision — refusal permanence', () => {
  it.each([
    ['free', { offering: { ...candidate().offering!, isConsult: true } }],
    ['offering-archived', { offering: { ...candidate().offering!, archived: true } }],
    ['no-offering', { offering: null }],
    ['payments-not-live', { practitionerPayoutsEnabled: false }],
    ['already-paid', { paidAt: NOW }],
  ])('marks %s PERMANENT, so the row stops matching', (_r, over) => {
    const d = resumeDecision(candidate(over as Partial<ResumeCandidate>), NOW);
    expect(d.send).toBe(false);
    expect((d as { permanent: boolean }).permanent).toBe(true);
  });

  it.each([
    ['too-soon-since-capture', { createdAt: minutesAgo(2), scheduledAt: minutesAgo(1) }],
    ['too-soon-since-schedule', { scheduledAt: minutesAgo(1) }],
  ])('marks %s TRANSIENT — recording it would silently drop a recoverable buyer', (_r, over) => {
    const d = resumeDecision(candidate(over as Partial<ResumeCandidate>), NOW);
    expect(d.send).toBe(false);
    expect((d as { permanent: boolean }).permanent).toBe(false);
  });
});
