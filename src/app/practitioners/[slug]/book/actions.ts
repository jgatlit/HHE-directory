'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { rateLimit } from '@/lib/rate-limit';
import { listedWhere } from '@/lib/practitioner-indexer';
import { parseCapture, isResumable } from '@/lib/booking-intent';

/**
 * Step 1 (§5) — CAPTURE. Creates the BookingIntent the rest of the flow hangs off.
 *
 * PUBLIC AND UNAUTHENTICATED by design: the buyer is not a user and never will be, so
 * `withAuth(...)` does not apply. Everything arriving here is untrusted, which drives three
 * properties below — scoped id resolution, bounded input, and idempotent repeats.
 *
 * ⚠️ THE RATE LIMITER DOES NOT ENFORCE IN PRODUCTION TODAY. `src/lib/rate-limit.ts` no-ops when
 * KV envs are absent (`if (!hasKv) return { success: true }`), and no KV_REST_API_* is set on the
 * production environment — verified 2026-08-14. It is called anyway so it starts working the
 * moment a store is provisioned, but it must NOT be treated as the bound that holds. The bound
 * that actually holds is the dedupe window: a repeat submission for the same
 * (practitioner, email) resumes the existing PENDING intent instead of inserting a row.
 */
export async function startBookingIntent(slug: string, formData: FormData): Promise<void> {
  const parsed = parseCapture({
    name: String(formData.get('name') ?? ''),
    email: String(formData.get('email') ?? ''),
    phone: String(formData.get('phone') ?? ''),
    note: String(formData.get('note') ?? ''),
  });

  const back = (error: string, qs = '') =>
    `/practitioners/${encodeURIComponent(slug)}/book?error=${encodeURIComponent(error)}${qs}`;

  // Preserve the entry context across a validation bounce, or a buyer who mistypes their email
  // silently loses the offering they picked and lands in the generic flow.
  const linkId = String(formData.get('bookingLinkId') ?? '').trim();
  const offeringId = String(formData.get('offeringId') ?? '').trim();
  const context =
    (linkId ? `&link=${encodeURIComponent(linkId)}` : '') +
    (offeringId ? `&offering=${encodeURIComponent(offeringId)}` : '');

  if (!parsed.ok) redirect(back(parsed.error.replace(/^USER:/, ''), context));

  // The practitioner must be publicly LISTED. Same gate as the profile and Typesense, so a
  // delisted or expired practitioner cannot keep taking leads through a bookmarked flow URL.
  const practitioner = await prisma.practitioner.findFirst({
    where: { slug, ...listedWhere() },
    select: { id: true },
  });
  // IDOR discipline: "no such practitioner" and "not bookable" are one response.
  if (!practitioner) redirect(`/practitioners/${encodeURIComponent(slug)}`);

  // Both ids are user-supplied. Resolve each scoped to THIS practitioner and drop anything that
  // does not belong — a forged id must not attach a lead to another practitioner's link.
  const [bookingLink, offering] = await Promise.all([
    linkId
      ? prisma.bookingLink.findFirst({
          where: { id: linkId, practitionerId: practitioner.id },
          select: { id: true },
        })
      : null,
    offeringId
      ? prisma.whopProduct.findFirst({
          where: { id: offeringId, practitionerId: practitioner.id, archived: false },
          select: { id: true, bookingLinkId: true },
        })
      : null,
  ]);

  // §2 — entry_point and offering_id are BOTH nullable precisely so a booking-link CTA with zero
  // linked Offerings is a supported entry point. A null offering is never an error here.
  const entryPoint = offering ? 'OFFERING_CARD' : 'BOOKING_LINK';
  const resolvedLinkId = bookingLink?.id ?? offering?.bookingLinkId ?? null;

  const ip = headers().get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  await rateLimit('booking-capture', ip, { limit: 20, windowSeconds: 600 });

  // Idempotent repeat. A double-submit, a back-button re-post, or a buyer returning within the
  // window resumes their own PENDING intent rather than handing the practitioner a duplicate
  // lead. Scoped by email AND practitioner so two practitioners never share an intent.
  const existing = await prisma.bookingIntent.findFirst({
    where: { practitionerId: practitioner.id, email: parsed.value.email, status: 'PENDING' },
    orderBy: { createdAt: 'desc' },
    select: { id: true, createdAt: true },
  });

  const intentId =
    existing && isResumable(existing.createdAt, new Date())
      ? (
          await prisma.bookingIntent.update({
            where: { id: existing.id },
            data: {
              ...parsed.value,
              entryPoint,
              bookingLinkId: resolvedLinkId,
              offeringId: offering?.id ?? null,
            },
            select: { id: true },
          })
        ).id
      : (
          await prisma.bookingIntent.create({
            data: {
              practitionerId: practitioner.id,
              ...parsed.value,
              entryPoint,
              bookingLinkId: resolvedLinkId,
              offeringId: offering?.id ?? null,
            },
            select: { id: true },
          })
        ).id;

  // The intent id lives in the URL so return is IDEMPOTENT — that is what makes the T3 new-tab
  // fallback and §10's resume link work (§5, §8 failure table).
  redirect(`/practitioners/${encodeURIComponent(slug)}/book/${intentId}`);
}
