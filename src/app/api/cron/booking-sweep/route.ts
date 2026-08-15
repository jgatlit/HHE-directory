import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sendEmail } from '@/lib/email';
import { SITE_URL } from '@/lib/site';
import { listedWhere } from '@/lib/practitioner-indexer';
import {
  COLD_LEAD_MS,
  RESUME_AFTER_CAPTURE_MS,
  resumeCopy,
  resumeDecision,
} from '@/lib/booking-recovery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * §10 abandonment sweep. Wired as a Vercel Cron in vercel.json.
 *
 * Two jobs, matching §10's two miss states:
 *
 *   (b) SCHEDULED but never paid → resume email to the BUYER, plus the dashboard row that
 *       `BookingsSection` renders. This is the state the whole section exists for.
 *   (a) PENDING and now cold     → relabelled ABANDONED. NO buyer email, by design: they never
 *       reached a checkout, so there is nothing to resume and mailing them would be marketing.
 *
 * Like trial-sweep, this exists because the thing it reacts to IS NOT AN EVENT. Nobody abandons a
 * checkout; they simply stop, and no request ever arrives to notice it. Without a sweep the
 * scheduled-but-unpaid state is recorded perfectly and acted on never — which is exactly what the
 * first real booking through this flow did: captured, scheduled 22 seconds later, and then sat
 * unpaid with the practitioner's only notification still saying "they may still be choosing a
 * time".
 *
 * Auth: same shape as trial-sweep and /api/health/search — requires
 * `Authorization: Bearer <CRON_SECRET>` when CRON_SECRET is set (Vercel Cron sends it
 * automatically), open when unset so it can be curled in local dev.
 *
 * IDEMPOTENCY is Resend's, not ours. `booking-resume/<id>` de-duplicates for 24h, which is what
 * makes a 15-minute cron safe: an intent stays eligible on every run until it is paid, so without
 * that key this would mail the same buyer every 15 minutes for as long as they stayed unpaid.
 * Note the honest limit — past 24h the key expires and a still-unpaid intent becomes eligible for
 * a SECOND email. That is bounded (one per day) and is why the sweep also stops mailing once the
 * intent is no longer resumable, but it is not zero. A durable "resume sent" column is the real
 * fix if this ever needs to be exactly-once.
 */

/** Cheap pre-filter only. The real decision is `resumeDecision()`, which owns the §10 rules. */
const RESUME_CANDIDATE_TAKE = 200;

export async function GET(request: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  if (!process.env.RESEND_API_KEY) {
    // Missing config, not an empty result. Reporting `sent: 0` here would be the silent failure
    // this route exists to prevent — same call trial-sweep makes.
    console.error('[booking-sweep] RESEND_API_KEY is not set; cannot send resume emails');
    return NextResponse.json({ error: 'RESEND_API_KEY is not configured' }, { status: 500 });
  }

  const now = new Date();
  const resume = { matched: 0, sent: 0, skipped: 0, failed: 0 };
  const skipReasons: Record<string, number> = {};
  const failures: { intentId: string; error: string }[] = [];

  // Narrow on what an index can serve — status, unpaid, old enough to be worth looking at — and
  // leave every §10 rule to resumeDecision(). Restating `payments_live` as a Prisma `where` would
  // create a second definition of the one condition that decides whether a checkout step exists.
  //
  // The listing gate is applied HERE rather than in code because it is not a §10 rule: a delisted
  // or trial-expired practitioner's flow page 404s, so a resume link would mail the buyer a dead
  // end. Same gate the page and the signal action use.
  const candidates = await prisma.bookingIntent.findMany({
    where: {
      status: 'SCHEDULED',
      paidAt: null,
      createdAt: { lte: new Date(now.getTime() - RESUME_AFTER_CAPTURE_MS) },
      practitioner: listedWhere(),
    },
    select: {
      id: true,
      publicToken: true,
      name: true,
      email: true,
      status: true,
      paidAt: true,
      createdAt: true,
      scheduledAt: true,
      practitioner: { select: { slug: true, displayName: true, whopPayoutsEnabled: true } },
      offering: {
        select: {
          title: true,
          archived: true,
          acceptsPayments: true,
          whopPlanId: true,
          priceUsdCents: true,
          isConsult: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
    take: RESUME_CANDIDATE_TAKE,
  });

  resume.matched = candidates.length;
  // A silent cap reads as "covered everything" when it did not. At pilot scale this will never
  // bind; saying so when it does is cheaper than discovering it from a gap in the sends.
  if (candidates.length === RESUME_CANDIDATE_TAKE) {
    console.warn(
      `[booking-sweep] candidate cap hit (${RESUME_CANDIDATE_TAKE}); older intents deferred to the next run`,
    );
  }

  for (const intent of candidates) {
    const decision = resumeDecision(
      {
        status: intent.status,
        paidAt: intent.paidAt,
        createdAt: intent.createdAt,
        scheduledAt: intent.scheduledAt,
        offering: intent.offering,
        practitionerPayoutsEnabled: intent.practitioner.whopPayoutsEnabled,
      },
      now,
    );

    if (!decision.send) {
      resume.skipped += 1;
      skipReasons[decision.reason] = (skipReasons[decision.reason] ?? 0) + 1;
      continue;
    }

    // SITE_URL, not a request host: a cron has no buyer request to derive an origin from, and
    // this URL is going into someone's inbox where it must point at production.
    const resumeUrl = `${SITE_URL}/practitioners/${encodeURIComponent(
      intent.practitioner.slug,
    )}/book/${intent.publicToken}`;

    const { subject, text, html } = resumeCopy({
      firstName: intent.name.split(' ')[0] ?? '',
      practitionerName: intent.practitioner.displayName,
      // resumeDecision() has already refused every intent with no offering, so this fallback is
      // unreachable — it exists so the type narrows without an assertion.
      offeringTitle: intent.offering?.title ?? 'your booking',
      resumeUrl,
    });

    try {
      await sendEmail({
        to: intent.email,
        subject,
        text,
        html,
        // 24h de-duplication. This is what makes a 15-minute cron safe — see the note above.
        idempotencyKey: `booking-resume/${intent.id}`,
        tags: [{ name: 'feature', value: 'booking-sweep' }],
      });
      resume.sent += 1;
    } catch (err) {
      // Fail soft per recipient, loud in the response: one bad address must not abort the run for
      // everyone else, but a sweep that swallowed sends would be indistinguishable from one with
      // nothing to do.
      const message = err instanceof Error ? err.message : String(err);
      resume.failed += 1;
      failures.push({ intentId: intent.id, error: message });
      console.error('[booking-sweep] RESUME SEND FAILED', JSON.stringify({ intentId: intent.id, error: message }));
    }
  }

  // State (a) — captured, never scheduled, now cold. Relabelled for the practitioner's lead list;
  // NO buyer email, because they never reached a checkout to abandon.
  //
  // SCHEDULED intents are deliberately excluded however old they get: §10 calls that state "a
  // follow-up, not a loss", and filing it under abandoned would bury the one thing this section
  // exists to rescue. See COLD_LEAD_MS for why this transition is a judgment call at all.
  const cold = await prisma.bookingIntent.updateMany({
    where: {
      status: 'PENDING',
      paidAt: null,
      createdAt: { lte: new Date(now.getTime() - COLD_LEAD_MS) },
    },
    data: { status: 'ABANDONED' },
  });

  const ok = failures.length === 0;
  return NextResponse.json(
    { ok, resume, skipReasons, abandoned: cold.count, failures },
    { status: ok ? 200 : 207 },
  );
}
