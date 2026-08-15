'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { listedWhere } from '@/lib/practitioner-indexer';
import { isValidScheduleSignal } from '@/lib/booking-flow';

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
  if (!isValidScheduleSignal(signal)) return { ok: false };

  // Scoped by slug + listing gate, and only ever advances a PENDING intent. A SCHEDULED intent
  // re-submitting is a no-op rather than an error — the buyer may legitimately click twice, and
  // a PAID intent must never be dragged backwards by a stale tab.
  const updated = await prisma.bookingIntent.updateMany({
    where: {
      id: intentId,
      status: 'PENDING',
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
