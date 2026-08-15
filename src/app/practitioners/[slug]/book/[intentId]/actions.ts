'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { listedWhere } from '@/lib/practitioner-indexer';
import { isClientScheduleSignal } from '@/lib/booking-flow';
import { rateLimit } from '@/lib/rate-limit';
import { headers } from 'next/headers';

/**
 * Record that the buyer moved past step 2 (§8).
 *
 * PUBLIC AND UNAUTHENTICATED, like the rest of the flow — the buyer is not a user. The intent id
 * is the credential, so it is resolved scoped to the slug AND through the listing gate, exactly
 * as the page is. (That the id is a cuid rather than a random token is a known weakness, filed
 * separately; it is not made worse here.)
 *
 * ⚠️ THIS IS NOT A GUARD. D8: no external signal is a state-transition guard, and the buyer
 * advances the flow. This records what we OBSERVED — `SELF_REPORT` when they said so, `ASSUMED`
 * when they simply continued — so the practitioner can see that an unverified booking is
 * unverified. It must never be able to block anyone.
 */
export async function recordScheduleSignal(
  slug: string,
  intentId: string,
  signal: string,
): Promise<{ ok: boolean }> {
  // EVENT is not client-reportable — see isClientScheduleSignal.
  if (!isClientScheduleSignal(signal)) return { ok: false };

  // Same throttle the sibling capture action applies. cuids are timestamp-prefixed, so ids from a
  // known window are enumerable at far better than random odds; without this a script could flip
  // other buyers' intents to SCHEDULED and suppress §10's abandonment recovery for them.
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
      id: intentId,
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

  if (updated.count > 0) revalidatePath(`/practitioners/${slug}/book/${intentId}`);
  // `count === 0` means already advanced, or not ours. Both report ok: the buyer's journey is
  // not blocked by our bookkeeping, which is the whole point of D8.
  return { ok: true };
}

/**
 * Mark an intent PAID from the embed's `onComplete` (§9).
 *
 * ⚠️ THIS IS AN ACCELERATOR, NOT THE RECORD. The authority is `payment.succeeded` reconciling to
 * the session's `booking_intent_id` server-side — a buyer who closes the tab mid-redirect never
 * fires this callback and must still be attributed. All this does is make the UI honest
 * immediately instead of waiting on a webhook.
 *
 * Only ever advances SCHEDULED or PENDING (§5: a subscription with no calendar goes 1 → 3, so
 * PENDING is a legitimate pre-payment state). Never re-writes an already-PAID intent.
 */
export async function markIntentPaid(slug: string, intentId: string): Promise<{ ok: boolean }> {
  const ip =
    headers().get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headers().get('x-real-ip')?.trim() ||
    'unknown';
  const limited = await rateLimit('booking-paid', ip, { limit: 60, windowSeconds: 600 });
  if (!limited.success) return { ok: false };

  const updated = await prisma.bookingIntent.updateMany({
    where: {
      id: intentId,
      status: { in: ['PENDING', 'SCHEDULED'] },
      practitioner: { slug, ...listedWhere() },
    },
    data: { status: 'PAID' },
  });

  if (updated.count > 0) revalidatePath(`/practitioners/${slug}/book/${intentId}`);
  // count === 0 means already PAID, or not ours. Reported ok either way — the webhook is the
  // authority and the buyer must never see an error for bookkeeping that already succeeded.
  return { ok: true };
}
