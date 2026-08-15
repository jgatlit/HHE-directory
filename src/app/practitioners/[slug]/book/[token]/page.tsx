import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Check } from 'lucide-react';
import { prisma } from '@/lib/prisma';
import { listedWhere } from '@/lib/practitioner-indexer';
import { Card } from '@/components/ui/card';
import { flowShape, paymentsLive } from '@/lib/booking-flow';
import { SchedulerStep } from '@/components/booking/SchedulerStep';
import { recordScheduleSignal } from './actions';
import { createBookingCheckoutSession } from '@/lib/whop';
import { CheckoutStep } from '@/components/booking/CheckoutStep';
import { headers } from 'next/headers';

type Props = { params: { slug: string; token: string } };

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * The flow shell, addressed by BookingIntent.publicToken (§5).
 *
 * THE TOKEN IN THE URL IS THE POINT. It is what makes returning here IDEMPOTENT, which is what
 * lets the T3 new-tab fallback and §10's resume link work at all — a buyer who leaves for their
 * scheduler, or returns from an abandonment email an hour later, lands on the same intent rather
 * than starting over or creating a second lead.
 *
 * It is a RANDOM token rather than the primary key precisely because it is an unauthenticated
 * bearer credential that §10 mails out. See the column's own docstring for why a cuid was not
 * good enough for that job.
 */
export default async function BookingFlowPage({ params }: Props) {
  // Scoped by slug AND through the listing gate, matching the capture page and action: the token
  // alone is a bearer credential, and without the gate a bookmarked URL would keep serving a
  // delisted or trial-expired practitioner's calendar indefinitely. IDOR discipline — a mismatch,
  // a missing row and an unlisted practitioner all produce one identical 404.
  const intent = await prisma.bookingIntent.findFirst({
    where: { publicToken: params.token, practitioner: { slug: params.slug, ...listedWhere() } },
    select: {
      id: true,
      publicToken: true,
      name: true,
      status: true,
      practitioner: { select: { slug: true, displayName: true, whopPayoutsEnabled: true } },
      email: true,
      whopCheckoutSessionId: true,
      whopCheckoutSessionExpiresAt: true,
      paidAt: true,
      offering: {
        select: {
          title: true,
          archived: true,
          acceptsPayments: true,
          whopPlanId: true,
          whopCheckoutConfigId: true,
          purchaseUrl: true,
        },
      },
      bookingLink: { select: { url: true, label: true } },
    },
  });
  if (!intent) notFound();

  // An offering archived after capture must stop driving this flow — otherwise the buyer can pay
  // for something the practitioner has retired (archiving and unpublishing are separate actions,
  // so the Whop fields may still be populated). Both other entry points already scope on this.
  const offering = intent.offering && !intent.offering.archived ? intent.offering : null;

  const live = offering
    ? paymentsLive({
        acceptsPayments: offering.acceptsPayments,
        practitionerPayoutsEnabled: intent.practitioner.whopPayoutsEnabled,
        whopPlanId: offering.whopPlanId,
      })
    : false;

  const shape = flowShape({
    hasSchedulerUrl: !!intent.bookingLink?.url,
    paymentsLive: live,
  });

  // A settled intent must not render an actionable screen: showing "pick a time" to someone who
  // already paid invites a second booking of a session they hold, and §10's resume link points
  // at this exact URL.
  const settled = intent.status === 'PAID' || intent.paidAt !== null;
  // Already past step 2. Rendering the scheduler again would hide the payment CTA behind a
  // second trip through a calendar they have already used — and §10's resume email points here.
  const alreadyScheduled = intent.status === 'SCHEDULED';
  const schedulerUrl = intent.bookingLink?.url ?? null;
  const needsSchedule = shape.showSchedule && schedulerUrl !== null && !alreadyScheduled;
  const checkoutUrl = live ? (offering?.purchaseUrl ?? null) : null;

  // Mint ONLY when the checkout step will actually render, and reuse the stored session until it
  // expires.
  //
  // An earlier revision minted on every render of this public force-dynamic page — including the
  // scheduler branch, which never used the result — so an ordinary refresh, prefetch or crawler
  // drove unbounded POSTs to Whop and blocked TTFB for nothing. Worse, a buyer who refreshed
  // mid-payment received a BRAND-NEW session, i.e. a second chargeable checkout.
  //
  // Reusing the stored session is what makes a refresh safe. But a session is NOT durable — Whop
  // returns `expires_at` 24h out — and §10's whole purpose is to bring a buyer back LATER, so an
  // expired-or-unknown session must re-mint rather than render a dead payment form. A null expiry
  // means "minted before we recorded expiries", i.e. unknown age, so it re-mints too.
  const canEmbed = live && !settled && !!offering?.whopPlanId && !!offering.whopCheckoutConfigId;
  const willRenderCheckout = canEmbed && !needsSchedule;
  // After the buyer advances past step 2 the server re-renders into the embed, so step 2 must not
  // offer the unattributed hosted link in the meantime.
  const willEmbedAfterSchedule = canEmbed && needsSchedule;

  const storedExpiry = intent.whopCheckoutSessionExpiresAt;
  const sessionUsable =
    !!intent.whopCheckoutSessionId && storedExpiry !== null && storedExpiry.getTime() > Date.now();
  let checkoutSessionId: string | null = sessionUsable ? intent.whopCheckoutSessionId : null;

  if (willRenderCheckout && !checkoutSessionId) {
    checkoutSessionId = await createBookingCheckoutSession({
      checkoutConfigurationId: offering!.whopCheckoutConfigId!,
      bookingIntentId: intent.id,
    })
      .then(async (r) => {
        // Guarded write, not a bare update. Two requests can reach the mint before either stores
        // (a resume link opened twice, a double-click, a prefetch racing the navigation); a plain
        // update would let the second overwrite the first, orphaning a chargeable session on Whop
        // and leaving one browser holding a discarded id. Whoever writes first wins, and the
        // loser re-reads and uses the winner's session.
        const claimed = await prisma.bookingIntent.updateMany({
          where: {
            id: intent.id,
            OR: [
              { whopCheckoutSessionId: null },
              { whopCheckoutSessionExpiresAt: null },
              { whopCheckoutSessionExpiresAt: { lte: new Date() } },
            ],
          },
          data: { whopCheckoutSessionId: r.sessionId, whopCheckoutSessionExpiresAt: r.expiresAt },
        });
        if (claimed.count > 0) return r.sessionId;

        const winner = await prisma.bookingIntent.findUnique({
          where: { id: intent.id },
          select: { whopCheckoutSessionId: true },
        });
        return winner?.whopCheckoutSessionId ?? r.sessionId;
      })
      // Never fatal — a failed mint degrades to the hosted checkout (§8) rather than stranding a
      // buyer who is ready to pay.
      .catch((err) => {
        console.error('[booking] checkout session mint failed', {
          intentId: intent.id,
          error: err instanceof Error ? err.message : String(err),
        });
        return null;
      });
  }

  // Request-scoped, so a preview deployment returns the buyer to ITSELF. SITE_URL is documented
  // for code with no request to derive an origin from (crons, scripts) — using it here would send
  // a buyer returning from an external wallet to production, where this intent does not exist,
  // and 404 them mid-payment.
  const h = headers();
  const host = h.get('host') ?? 'naturalhealthpros.com';
  // Trust the proxy's own scheme header first — Vercel sets it, and it is right for every
  // deployment. The local fallback tests for a PRIVATE host rather than the literal string
  // "localhost": `127.0.0.1:3000` and a LAN IP are both ordinary ways to run this (the latter is
  // what `next dev` binds when reached from a phone), and both would otherwise be handed an
  // https:// return url that refuses the connection mid-payment.
  const forwardedProto = h.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const hostname = host.split(':')[0];
  const isLocal =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname.endsWith('.local') ||
    /^(10|127)\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(hostname);
  const proto = forwardedProto === 'http' || forwardedProto === 'https'
    ? forwardedProto
    : isLocal
      ? 'http'
      : 'https';
  const intentUrl = `${proto}://${host}/practitioners/${encodeURIComponent(params.slug)}/book/${intent.publicToken}`;

  const advance = recordScheduleSignal.bind(null, params.slug, intent.publicToken);
  const firstName = intent.name.split(' ')[0];

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:py-14">
      <Card className="space-y-4 p-6 sm:p-8">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
            <Check className="h-4 w-4 text-primary" aria-hidden />
          </span>
          <div className="space-y-0.5">
            <h1 className="text-sm font-semibold">
              Thanks{firstName ? `, ${firstName}` : ''} — {intent.practitioner.displayName} has
              your details.
            </h1>
            <p className="text-xs text-muted-foreground">
              {offering?.title ?? intent.bookingLink?.label ?? 'Booking'}
            </p>
          </div>
        </div>

        {settled ? (
          <p className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
            This booking is already complete — nothing further to do. If you need to change it,
            contact {intent.practitioner.displayName} directly.
          </p>
        ) : needsSchedule ? (
          <SchedulerStep
            schedulerUrl={schedulerUrl!}
            practitionerName={intent.practitioner.displayName}
            onAdvance={advance}
            // NULL when an embed is possible. The hosted URL carries practitioner_id and
            // offering_id but NOT booking_intent_id, so a buyer who took it would pay through an
            // unattributable session and never be recorded. After advancing, the step refreshes
            // and the server renders the embedded checkout instead. The hosted link survives only
            // where no embed can be minted (§8).
            checkoutUrl={willEmbedAfterSchedule ? null : checkoutUrl}
            checkoutComing={willEmbedAfterSchedule}
          />
        ) : canEmbed && checkoutSessionId ? (
          // D11 — embedded, addressed by the SESSION, so the flow never leaves our page. Reached
          // two ways: §5's "subscription / no scheduling" row (1 → 3), and a returning buyer whose
          // intent is already SCHEDULED.
          //
          // Gated on `canEmbed`, NOT on the stored session alone. A session outlives the
          // conditions it was minted under: if the practitioner unticks "accepts payments", or a
          // payout_account.status_updated / identity_profile.rejected webhook clears
          // whopPayoutsEnabled, `live` goes false — and a session-only gate would keep serving a
          // working payment form into an account that may not be able to withdraw, which
          // publishOffering's own hard gate calls the worst possible failure.
          <CheckoutStep
            sessionId={checkoutSessionId}
            email={intent.email}
            returnUrl={intentUrl}
            fallbackUrl={checkoutUrl}
          />
        ) : checkoutUrl ? (
          // §8 fallback — the session mint failed, so hand over the hosted checkout rather than
          // stranding a buyer who is ready to pay.
          <div className="space-y-2 rounded-md border bg-muted/20 p-3">
            <p className="text-xs text-muted-foreground">
              {alreadyScheduled ? 'Last step — payment.' : 'No scheduling needed — just payment.'}
            </p>
            <a
              href={checkoutUrl}
              className="inline-flex h-11 w-full items-center justify-center rounded-md bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Continue to payment
            </a>
          </div>
        ) : alreadyScheduled ? (
          <p className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
            You&apos;re all set — {intent.practitioner.displayName} has your details and your time.
          </p>
        ) : (
          <p className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
            {intent.practitioner.displayName} will be in touch to arrange a time.
          </p>
        )}

        <Link
          href={`/practitioners/${intent.practitioner.slug}`}
          className="block text-center text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          Back to profile
        </Link>
      </Card>
    </main>
  );
}
