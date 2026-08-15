'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { isClientScheduleSignal } from '@/lib/booking-flow';
import { rateLimit } from '@/lib/rate-limit';
import { headers } from 'next/headers';

/**
 * Record that the buyer moved past step 2 (§8).
 *
 * PUBLIC AND UNAUTHENTICATED, like the rest of the flow — the buyer is not a user. The token in
 * the URL is the credential, so it is resolved scoped to the slug, exactly as the page is. NOT
 * through the listing gate — unlisted means "not in directory search", not "cannot be booked".
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
      practitioner: { slug },
    },
    data: {
      status: 'SCHEDULED',
      scheduleSignal: signal,
      // Our observation time, NOT the appointment time — we do not know when the appointment is
      // and must not imply we do. The practitioner's calendar remains the source of truth (§18).
      scheduledAt: new Date(),
    },
  });

  if (updated.count > 0) revalidatePath(`/practitioners/${slug}/book/${token}`);

  // NO EMAIL IS SENT FROM HERE. The practitioner's "someone booked a time" notice is the booking
  // sweep's job (/api/cron/booking-sweep), for two reasons that both bite at this exact point in
  // the flow:
  //
  //   1. D8 and src/lib/email.ts both say do not put a network send on the buyer's path. This
  //      action runs at the highest-drop-off moment there is — the buyer is waiting for checkout
  //      to appear — and a slow Resend call would add dead seconds to it.
  //   2. This endpoint is public and unauthenticated with no per-practitioner burst bound. The
  //      sibling capture action caps lead emails at 15 per practitioner per 10 minutes precisely
  //      so an inbox cannot be flooded; sending from here would bypass that guard using the step
  //      immediately after it.
  // `count === 0` means already advanced, or not ours. Both report ok: the buyer's journey is
  // not blocked by our bookkeeping, which is the whole point of D8.
  return { ok: true };
}
