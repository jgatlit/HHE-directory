'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { listedWhere } from '@/lib/practitioner-indexer';
import { isClientScheduleSignal, paymentsLive } from '@/lib/booking-flow';
import { scheduledNoticeCopy } from '@/lib/booking-recovery';
import { sendEmail } from '@/lib/email';
import { SITE_URL } from '@/lib/site';
import { rateLimit } from '@/lib/rate-limit';
import { headers } from 'next/headers';

/**
 * Record that the buyer moved past step 2 (§8).
 *
 * PUBLIC AND UNAUTHENTICATED, like the rest of the flow — the buyer is not a user. The token in
 * the URL is the credential, so it is resolved scoped to the slug AND through the listing gate,
 * exactly as the page is.
 *
 * ⚠️ THIS IS NOT A GUARD. D8: no external signal is a state-transition guard, and the buyer
 * advances the flow. This records what we OBSERVED — `SELF_REPORT` when they said so, `ASSUMED`
 * when they simply continued — so the practitioner can see that an unverified booking is
 * unverified. It must never be able to block anyone.
 */
export async function recordScheduleSignal(
  slug: string,
  token: string,
  signal: string,
): Promise<{ ok: boolean }> {
  // EVENT is not client-reportable — see isClientScheduleSignal.
  if (!isClientScheduleSignal(signal)) return { ok: false };

  // Same throttle the sibling capture action applies. Addressing by a random publicToken removed
  // the enumeration shortcut that made this urgent — a cuid's timestamp prefix let ids from a
  // known window be guessed at far better than random odds — but the bound stays: it is what
  // stops a script flipping other buyers' intents to SCHEDULED and suppressing §10's recovery
  // for them, and it is the only bound at all while KV is unprovisioned.
  const ip =
    headers().get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headers().get('x-real-ip')?.trim() ||
    'unknown';
  const limited = await rateLimit('booking-signal', ip, { limit: 60, windowSeconds: 600 });
  if (!limited.success) return { ok: false };

  // Scoped by slug + listing gate, and only ever advances a PENDING intent. A SCHEDULED intent
  // re-submitting is a no-op rather than an error — the buyer may legitimately click twice, and
  // a PAID intent must never be dragged backwards by a stale tab.
  const updated = await prisma.bookingIntent.updateMany({
    where: {
      publicToken: token,
      // ABANDONED belongs here too: §10's resume email targets exactly those intents, so
      // excluding it meant a recovered booking could never be recorded — the action reported
      // success while the intent stayed ABANDONED forever and was eligible to be swept again.
      // PAID is still excluded, which is the guarantee the filter existed for.
      status: { in: ['PENDING', 'ABANDONED'] },
      practitioner: { slug, ...listedWhere() },
    },
    data: {
      status: 'SCHEDULED',
      scheduleSignal: signal,
      // Our observation time, NOT the appointment time — we do not know when the appointment is
      // and must not imply we do. The practitioner's calendar remains the source of truth (§18).
      scheduledAt: new Date(),
    },
  });

  if (updated.count > 0) {
    revalidatePath(`/practitioners/${slug}/book/${token}`);
    // Guarded by `count > 0`, so a double-click or a stale tab cannot re-notify: only the request
    // that actually performed the PENDING → SCHEDULED transition sends.
    await notifyScheduled(token).catch((err) => {
      // Never fatal. D8 — our bookkeeping must not block the buyer, and the practitioner has the
      // dashboard row regardless of whether this email lands.
      console.error('[booking-signal] scheduled notice failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }
  // `count === 0` means already advanced, or not ours. Both report ok: the buyer's journey is
  // not blocked by our bookkeeping, which is the whole point of D8.
  return { ok: true };
}

/**
 * Tell the practitioner someone picked a time.
 *
 * This is the notification whose absence made the capture email lie. That email said the buyer
 * "may still be choosing a time" — which was true when it was sent and false 22 seconds later on
 * the first real booking this flow took, with nothing anywhere reporting the change.
 *
 * §11 — gated on `notifyLeadsImmediately`, because this is a LEAD-stage notification and that
 * setting means "tell me on checkout instead". The dashboard row is NOT gated (see
 * BookingsSection): §10's scheduled-but-unpaid obligation is a service commitment, not a
 * notification preference.
 */
async function notifyScheduled(token: string): Promise<void> {
  const intent = await prisma.bookingIntent.findUnique({
    where: { publicToken: token },
    select: {
      name: true,
      email: true,
      phone: true,
      scheduleSignal: true,
      practitioner: {
        select: {
          slug: true,
          notifyLeadsImmediately: true,
          whopPayoutsEnabled: true,
          user: { select: { email: true } },
        },
      },
      offering: {
        select: { title: true, priceUsdCents: true, acceptsPayments: true, whopPlanId: true },
      },
    },
  });
  if (!intent?.practitioner.user.email) return;
  if (!intent.practitioner.notifyLeadsImmediately) return;

  const live = intent.offering
    ? paymentsLive({
        acceptsPayments: intent.offering.acceptsPayments,
        practitionerPayoutsEnabled: intent.practitioner.whopPayoutsEnabled,
        whopPlanId: intent.offering.whopPlanId,
      })
    : false;

  const { subject, text, html } = scheduledNoticeCopy({
    buyerName: intent.name,
    buyerEmail: intent.email,
    buyerPhone: intent.phone,
    offeringTitle: intent.offering?.title ?? null,
    signal: intent.scheduleSignal ?? 'ASSUMED',
    profileUrl: `${SITE_URL}/practitioners/${encodeURIComponent(intent.practitioner.slug)}/edit`,
    // Only claim money is outstanding when a checkout actually existed — a free consult or an
    // off-platform sale owes nothing, and saying otherwise would send practitioners chasing
    // payments their own configuration never asked for.
    awaitingPayment: live && (intent.offering?.priceUsdCents ?? 0) > 0,
  });

  await sendEmail({
    to: intent.practitioner.user.email,
    subject,
    text,
    html,
    // One per intent: the transition happens once, and the count>0 guard above already prevents
    // a repeat. This is belt-and-braces against a replay.
    idempotencyKey: `booking-scheduled/${token}`,
    tags: [{ name: 'feature', value: 'booking-scheduled' }],
  });
}
