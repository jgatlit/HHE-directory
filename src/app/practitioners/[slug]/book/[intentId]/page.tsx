import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Check } from 'lucide-react';
import { prisma } from '@/lib/prisma';
import { listedWhere } from '@/lib/practitioner-indexer';
import { Card } from '@/components/ui/card';
import { flowShape, paymentsLive } from '@/lib/booking-flow';
import { SchedulerStep } from '@/components/booking/SchedulerStep';
import { recordScheduleSignal } from './actions';

type Props = { params: { slug: string; intentId: string } };

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * The flow shell, addressed by BookingIntent id (§5).
 *
 * THE ID IN THE URL IS THE POINT. It is what makes returning here IDEMPOTENT, which is what lets
 * the T3 new-tab fallback and §10's resume link work at all — a buyer who leaves for their
 * scheduler, or returns from an abandonment email an hour later, lands on the same intent rather
 * than starting over or creating a second lead.
 */
export default async function BookingFlowPage({ params }: Props) {
  // Scoped by slug AND through the listing gate, matching the capture page and action: the id
  // alone is a bearer token, and without the gate a bookmarked URL would keep serving a delisted
  // or trial-expired practitioner's calendar indefinitely. IDOR discipline — a mismatch, a
  // missing row and an unlisted practitioner all produce one identical 404.
  const intent = await prisma.bookingIntent.findFirst({
    where: { id: params.intentId, practitioner: { slug: params.slug, ...listedWhere() } },
    select: {
      id: true,
      name: true,
      status: true,
      practitioner: { select: { slug: true, displayName: true, whopPayoutsEnabled: true } },
      offering: {
        select: {
          title: true,
          archived: true,
          acceptsPayments: true,
          whopPlanId: true,
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
  const settled = intent.status === 'PAID';
  // Already past step 2. Rendering the scheduler again would hide the payment CTA behind a
  // second trip through a calendar they have already used — and §10's resume email points here.
  const alreadyScheduled = intent.status === 'SCHEDULED';
  const checkoutUrl = live ? (offering?.purchaseUrl ?? null) : null;

  const advance = recordScheduleSignal.bind(null, params.slug, intent.id);
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
        ) : shape.showSchedule && intent.bookingLink?.url && !alreadyScheduled ? (
          <SchedulerStep
            schedulerUrl={intent.bookingLink.url}
            practitionerName={intent.practitioner.displayName}
            onAdvance={advance}
            // §17.3c replaces this with Whop's embedded checkout addressed by plan id (D11).
            // Until then the existing hosted checkout is used rather than a dead end.
            checkoutUrl={checkoutUrl}
          />
        ) : checkoutUrl ? (
          // Reached two ways, and BOTH were previously dead ends: §5's "subscription / no
          // scheduling" row (1 → 3, no calendar at all), and a returning buyer whose intent is
          // already SCHEDULED. `showCheckout` was computed and tested but only ever passed into
          // the scheduler, so neither could ever reach payment.
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
