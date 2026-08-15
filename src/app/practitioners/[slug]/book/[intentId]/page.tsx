import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Check, CalendarClock } from 'lucide-react';
import { prisma } from '@/lib/prisma';
import { Card } from '@/components/ui/card';

type Props = { params: { slug: string; intentId: string } };

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * The flow shell, addressed by BookingIntent id (§5).
 *
 * THE ID IN THE URL IS THE POINT. It is what makes returning here IDEMPOTENT, which is what lets
 * the T3 new-tab fallback and §10's resume link work at all — a buyer who leaves for their
 * scheduler, or comes back from an abandonment email an hour later, lands on the same intent
 * rather than starting over or creating a second lead.
 *
 * Step 2 (SCHEDULE) is §17.3b, and per §17 item 3 it is built on the NULL ADAPTER first and
 * treated as the real path — progressive enhancement, not graceful degradation. The reference
 * practitioner is on Acuity, which has no completion event, so the fallback IS her experience.
 */
export default async function BookingFlowPage({ params }: Props) {
  // Scoped by slug as well as id: the id alone is a bearer token, and a bare `findUnique` would
  // render one practitioner's lead under another's profile URL. IDOR discipline — a mismatch and
  // a missing row produce one identical 404.
  const intent = await prisma.bookingIntent.findFirst({
    where: { id: params.intentId, practitioner: { slug: params.slug } },
    select: {
      id: true,
      name: true,
      status: true,
      entryPoint: true,
      practitioner: { select: { slug: true, displayName: true } },
      offering: { select: { title: true, priceUsdCents: true, isConsult: true } },
      bookingLink: { select: { url: true, label: true, provider: true } },
    },
  });
  if (!intent) notFound();

  return (
    <main className="mx-auto max-w-lg px-4 py-10 sm:py-14">
      <Card className="space-y-4 p-6 sm:p-8">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
            <Check className="h-4 w-4 text-primary" aria-hidden />
          </span>
          <div className="space-y-0.5">
            <h1 className="text-sm font-semibold">
              Thanks{intent.name ? `, ${intent.name.split(' ')[0]}` : ''} — {intent.practitioner.displayName} has your details.
            </h1>
            <p className="text-xs text-muted-foreground">
              {intent.offering?.title ?? intent.bookingLink?.label ?? 'Booking'}
            </p>
          </div>
        </div>

        {/* Step 2 lands in §17.3b. Until it does, the buyer is handed the practitioner's own
            scheduler directly rather than a dead end — the lead is already captured, so this
            degrades to exactly the behaviour the profile had before the flow existed. */}
        {intent.bookingLink?.url ? (
          <div className="space-y-2 rounded-md border bg-muted/20 p-3">
            <p className="flex items-center gap-1.5 text-xs font-medium">
              <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              Next: pick a time
            </p>
            <a
              href={intent.bookingLink.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Open {intent.practitioner.displayName}&apos;s calendar
            </a>
          </div>
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
