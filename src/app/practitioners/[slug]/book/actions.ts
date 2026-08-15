'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { rateLimit } from '@/lib/rate-limit';
import { listedWhere } from '@/lib/practitioner-indexer';
import { parseCapture, type CaptureErrorCode } from '@/lib/booking-intent';
import { sendEmail } from '@/lib/email';
import { SITE_URL } from '@/lib/site';

/**
 * Step 1 (§5) — CAPTURE. Creates the BookingIntent the rest of the flow hangs off.
 *
 * PUBLIC AND UNAUTHENTICATED by design: the buyer is not a user and never will be, so
 * `withAuth(...)` does not apply and everything arriving here is untrusted.
 *
 * ⚠️ THERE IS NO EFFECTIVE RATE LIMIT IN PRODUCTION TODAY, and this comment does not pretend
 * otherwise. `src/lib/rate-limit.ts` no-ops when KV envs are absent, and no KV_REST_API_* is set
 * on production (verified 2026-08-14). The result IS checked below, so the throttle becomes real
 * the moment a store is provisioned — but until then a script varying the email address can
 * insert rows freely. An earlier version of this file claimed a dedupe window bounded that; it
 * did not, because varying the email defeats it entirely.
 *
 * 🚧 PROVISION KV BEFORE §17.4a LINKS THIS ROUTE FROM THE PROFILE. Today the flow is reachable
 * only by typing the URL, which is what keeps the exposure small.
 */
export async function startBookingIntent(slug: string, formData: FormData): Promise<void> {
  const raw = {
    name: String(formData.get('name') ?? ''),
    email: String(formData.get('email') ?? ''),
    phone: String(formData.get('phone') ?? ''),
    note: String(formData.get('note') ?? ''),
  };
  const linkId = String(formData.get('bookingLinkId') ?? '').trim();
  const offeringId = String(formData.get('offeringId') ?? '').trim();

  /**
   * Bounce back preserving what the buyer typed.
   *
   * `code` is an ERROR CODE, never a message. The page renders it through a fixed lookup, so a
   * crafted `?error=` cannot put attacker-chosen text inside a branded alert box on a page
   * carrying the practitioner's real name — a phishing surface reachable by link alone.
   *
   * The typed values ride along because losing them is a guaranteed drop-off at the one step
   * that is unconditional for every buyer: re-rendering an empty form after a mistyped email
   * discards the note they just wrote, which on this product is often the reason they came.
   */
  const bounce: (code: CaptureErrorCode) => never = (code) => {
    const qs = new URLSearchParams({ error: code });
    if (raw.name.trim()) qs.set('name', raw.name.slice(0, 200));
    if (raw.email.trim()) qs.set('email', raw.email.slice(0, 300));
    if (raw.phone.trim()) qs.set('phone', raw.phone.slice(0, 60));
    if (raw.note.trim()) qs.set('note', raw.note.slice(0, 2100));
    if (linkId) qs.set('link', linkId);
    if (offeringId) qs.set('offering', offeringId);
    redirect(`/practitioners/${encodeURIComponent(slug)}/book?${qs}`);
  };

  const parsed = parseCapture(raw);
  if (!parsed.ok) bounce(parsed.code);

  // The practitioner must be publicly LISTED — the same gate as the profile and the search index,
  // so a delisted or trial-expired practitioner cannot keep taking leads through a bookmarked URL.
  // IDOR discipline: "no such practitioner" and "not bookable" are one response.
  const practitioner = await prisma.practitioner.findFirst({
    where: { slug, ...listedWhere() },
    select: {
      id: true,
      displayName: true,
      notifyLeadsImmediately: true,
      primaryBookingLinkId: true,
      user: { select: { email: true } },
    },
  });
  if (!practitioner) redirect(`/practitioners/${encodeURIComponent(slug)}`);

  // Both ids are user-supplied; resolve each scoped to THIS practitioner.
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
          select: { id: true, title: true, bookingLinkId: true },
        })
      : null,
  ]);

  // A supplied id that does not resolve is a BROKEN LINK — matching the capture page, which 404s
  // on the same condition. Silently dropping it would downgrade a paid booking into a generic
  // enquiry without telling the buyer, and hand the practitioner a lead with no offering
  // attached and no indication anything was lost. (An offering can be archived while the buyer
  // has the form open, so this is reachable without any forgery at all.)
  if (linkId && !bookingLink) bounce('CONTEXT_GONE');
  if (offeringId && !offering) bounce('CONTEXT_GONE');

  const ip =
    headers().get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headers().get('x-real-ip')?.trim() ||
    'unknown';
  const limited = await rateLimit('booking-capture', ip, { limit: 20, windowSeconds: 600 });
  // CHECK the result. An earlier version awaited this and discarded it, so the limiter could
  // never block — not now, and not after KV is provisioned either.
  if (!limited.success) bounce('TOO_MANY');

  // §14.3 — with no explicit context, fall back to the practitioner's designated hero link rather
  // than dead-ending the buyer on "they will be in touch" while a live calendar exists.
  const resolvedLinkId =
    bookingLink?.id ?? offering?.bookingLinkId ?? practitioner.primaryBookingLinkId ?? null;

  // entryPoint is a DIAGNOSTIC (§4) — it proxies buyer intent at entry, so it must reflect what
  // the buyer actually clicked. Recording BOOKING_LINK for a context-less capture would poison it.
  const entryPoint = offering ? 'OFFERING_CARD' : 'BOOKING_LINK';

  // Always a NEW intent. A previous version resumed an existing PENDING row matched on
  // (practitioner, email) — which, with nothing binding the submitter to that address, let anyone
  // who knew a buyer's email read that buyer's intent and overwrite their name, phone and note.
  // On a health-adjacent directory the note is the most sensitive field we hold. It also
  // collapsed two genuinely distinct enquiries into one whenever a buyer asked about a second
  // service. Duplicate leads are the lesser failure; the pending-state button covers double-click.
  const intent = await prisma.bookingIntent.create({
    data: {
      practitionerId: practitioner.id,
      ...parsed.value,
      entryPoint,
      bookingLinkId: resolvedLinkId,
      offeringId: offering?.id ?? null,
    },
    select: { id: true },
  });

  // §5 — "this step is ours; the only point where lead capture is GUARANTEED." The whole reason
  // step 1 precedes the scheduler is that the practitioner keeps the lead even when the buyer
  // abandons at step 2. Creating the row without telling anyone would leave that promise unkept.
  //
  // Out of band and never fatal: a failed send must not lose a lead that is already committed,
  // and the buyer must not see an error for something that is not their problem.
  if (practitioner.notifyLeadsImmediately && practitioner.user.email) {
    await sendLeadEmail({
      to: practitioner.user.email,
      practitionerName: practitioner.displayName,
      slug,
      intentId: intent.id,
      lead: parsed.value,
      offeringTitle: offering?.title ?? null,
    }).catch((err) => {
      console.error('[booking-capture] lead email failed', {
        intentId: intent.id,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  // The intent id in the URL is what makes returning IDEMPOTENT — the T3 new-tab fallback and
  // §10's resume link both depend on it (§5, §8 failure table).
  redirect(`/practitioners/${encodeURIComponent(slug)}/book/${intent.id}`);
}

async function sendLeadEmail(params: {
  to: string;
  practitionerName: string;
  slug: string;
  intentId: string;
  lead: { name: string; email: string; phone: string | null; note: string | null };
  offeringTitle: string | null;
}): Promise<void> {
  const { lead } = params;
  const subject = params.offeringTitle
    ? `New enquiry — ${lead.name} · ${params.offeringTitle}`
    : `New enquiry — ${lead.name}`;

  const lines = [
    `${lead.name} just started booking with you on Natural Health Pros.`,
    '',
    `Email: ${lead.email}`,
    ...(lead.phone ? [`Phone: ${lead.phone}`] : []),
    ...(params.offeringTitle ? [`Interested in: ${params.offeringTitle}`] : []),
    ...(lead.note ? ['', 'They said:', lead.note] : []),
    '',
    // They may not have picked a time yet — that is the point of capturing first.
    'They may still be choosing a time. Either way you have their details now.',
    `${SITE_URL}/practitioners/${params.slug}`,
  ];

  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  await sendEmail({
    to: params.to,
    subject,
    text: lines.join('\n'),
    html: `<p>${esc(lead.name)} just started booking with you on Natural Health Pros.</p>
<p><strong>Email:</strong> ${esc(lead.email)}${lead.phone ? `<br><strong>Phone:</strong> ${esc(lead.phone)}` : ''}${
      params.offeringTitle ? `<br><strong>Interested in:</strong> ${esc(params.offeringTitle)}` : ''
    }</p>
${lead.note ? `<p><strong>They said:</strong><br>${esc(lead.note).replace(/\n/g, '<br>')}</p>` : ''}
<p>They may still be choosing a time. Either way you have their details now.</p>
<p><a href="${SITE_URL}/practitioners/${encodeURIComponent(params.slug)}">View your profile</a></p>`,
    // Keyed on the intent so a retry or replay cannot double-send the same lead.
    idempotencyKey: `booking-lead/${params.intentId}`,
    tags: [{ name: 'type', value: 'booking-lead' }],
  });
}
