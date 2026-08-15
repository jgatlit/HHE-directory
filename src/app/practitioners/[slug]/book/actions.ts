'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { bookableWhere } from '@/lib/practitioner-indexer';
import { rateLimit } from '@/lib/rate-limit';
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
 * 🚧 KV IS STILL UNPROVISIONED **AND THIS ROUTE IS NOW PUBLICLY LINKED** from every profile
 * (§17.4a). The obscurity that previously bounded the exposure is gone. The only bound in force
 * is the per-practitioner email suppression below, which protects a practitioner's inbox and
 * nothing else. See vault tsk_4ed1cffe7423469eba7c.
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

  // Gated by `bookableWhere()`, NOT `listedWhere()`. Unlisted practitioners stay bookable at
  // their direct link — that is what trial-sweep's warning email promises them — so the only
  // refusal here is a RETIRED row, whose owner mailbox is typically dead and whose leads would
  // therefore be captured, acknowledged to the buyer, and read by nobody.
  // IDOR discipline: "no such practitioner" and "not bookable" are one response.
  const practitioner = await prisma.practitioner.findFirst({
    where: { slug, ...bookableWhere() },
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

  // A per-practitioner burst bound that suppresses the EMAIL, never the capture.
  //
  // An earlier version REJECTED the capture past this threshold, which was a denial-of-service on
  // the victim rather than a defence: this endpoint is unauthenticated and the bound is keyed on
  // the PRACTITIONER, so anyone could fire 15 requests at a slug and make that practitioner
  // unbookable for ten minutes, renewably, at no cost. It also destroyed the lead — the one
  // artefact §5 says capture exists to guarantee.
  //
  // Bounding the email instead keeps both properties: a practitioner's inbox cannot be flooded,
  // and a genuine buyer arriving during a burst still has their details recorded and still
  // reaches the scheduler. Throttling the SUBMITTER is the KV limiter's job; this one only ever
  // protects the inbox.
  const recentForPractitioner = await prisma.bookingIntent.count({
    where: {
      practitionerId: practitioner.id,
      createdAt: { gte: new Date(Date.now() - 10 * 60 * 1000) },
    },
  });
  const emailSuppressed = recentForPractitioner >= 15;
  if (emailSuppressed) {
    // Visible, because the practitioner is not being told about leads they can still see in the
    // dashboard, and a silent suppression is indistinguishable from a broken sender.
    console.warn('[booking-capture] lead email suppressed by burst bound', {
      practitionerId: practitioner.id,
      recentForPractitioner,
    });
  }

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
    // publicToken is generated by Postgres (see the column's docstring), so it has to be read
    // BACK rather than supplied — it is what the redirect below addresses the flow by.
    select: { id: true, publicToken: true },
  });

  // §5 — "this step is ours; the only point where lead capture is GUARANTEED." The whole reason
  // step 1 precedes the scheduler is that the practitioner keeps the lead even when the buyer
  // abandons at step 2. Creating the row without telling anyone would leave that promise unkept.
  //
  // Out of band and never fatal: a failed send must not lose a lead that is already committed,
  // and the buyer must not see an error for something that is not their problem.
  if (practitioner.notifyLeadsImmediately && practitioner.user.email && !emailSuppressed) {
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

  // The token in the URL is what makes returning IDEMPOTENT — the T3 new-tab fallback and §10's
  // resume link both depend on it (§5, §8 failure table). A random token rather than the row's id,
  // because this URL is an unauthenticated bearer credential that §10 puts into inboxes.
  redirect(`/practitioners/${encodeURIComponent(slug)}/book/${intent.publicToken}`);
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
    // States what is true AT SEND TIME and nothing more. The previous wording — "they may still
    // be choosing a time" — was an assertion about a live state this email could never update:
    // on the first real booking the flow took it went stale 22 seconds later, and nothing told
    // the practitioner. The follow-up it promises is now real (see notifyScheduled).
    'They have not picked a time yet. We will email you again if they do, and their details stay',
    'in your dashboard either way.',
    `${SITE_URL}/practitioners/${params.slug}/edit`,
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
<p>They have not picked a time yet. We&rsquo;ll email you again if they do, and their details stay in your dashboard either way.</p>
<p><a href="${SITE_URL}/practitioners/${encodeURIComponent(params.slug)}/edit">View your dashboard</a></p>`,
    // Keyed on the intent so a retry or replay cannot double-send the same lead.
    idempotencyKey: `booking-lead/${params.intentId}`,
    tags: [{ name: 'type', value: 'booking-lead' }],
  });
}
