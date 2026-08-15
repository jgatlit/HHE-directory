import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { prisma } from '@/lib/prisma';
import { bookableWhere } from '@/lib/practitioner-indexer';
import { Card } from '@/components/ui/card';
import { CAPTURE_LIMITS, CAPTURE_ERRORS, type CaptureErrorCode } from '@/lib/booking-intent';
import { startBookingIntent } from './actions';
import { PendingButton } from '@/components/practitioners/PendingButton';

type Props = {
  params: { slug: string };
  searchParams: {
    link?: string;
    offering?: string;
    error?: string;
    name?: string;
    email?: string;
    phone?: string;
    note?: string;
  };
};

// Reads searchParams; there is nothing cacheable here.
export const dynamic = 'force-dynamic';

export const metadata = { robots: { index: false, follow: false } };

/**
 * Step 1 of the booking flow (§5) — the only UNCONDITIONAL step.
 *
 * Public and unauthenticated: the buyer is not a user. Gated by `bookableWhere()`, NOT
 * `listedWhere()` — see that function for the distinction. "Unlisted" means absent from directory
 * search, not switched off, and trial-sweep's own email promises the profile "stays live at its
 * direct link". What IS still refused is a RETIRED row: an operator artefact whose owner mailbox
 * is typically dead, so a lead captured there is silently lost while the buyer is told otherwise.
 */
export default async function BookCapturePage({ params, searchParams }: Props) {
  const practitioner = await prisma.practitioner.findFirst({
    where: { slug: params.slug, ...bookableWhere() },
    select: { id: true, slug: true, displayName: true },
  });
  if (!practitioner) notFound();

  // Both ids are user-supplied. Resolve scoped to this practitioner; a supplied id that does not
  // resolve is a BROKEN LINK, not a reason to silently downgrade the buyer into a different flow
  // — quietly dropping an offering id would turn a paid booking into a free consultation.
  // IDOR discipline: "does not exist" and "belongs to someone else" produce one identical 404.
  const [offering, bookingLink] = await Promise.all([
    searchParams.offering
      ? prisma.whopProduct.findFirst({
          where: { id: searchParams.offering, practitionerId: practitioner.id, archived: false },
          select: { id: true, title: true },
        })
      : null,
    searchParams.link
      ? prisma.bookingLink.findFirst({
          where: { id: searchParams.link, practitionerId: practitioner.id },
          select: { id: true, label: true },
        })
      : null,
  ]);
  if (searchParams.offering && !offering) notFound();
  if (searchParams.link && !bookingLink) notFound();

  // Rendered through a FIXED LOOKUP — never the raw parameter. Echoing arbitrary text into a
  // branded alert on a public page carrying the practitioner's name is a phishing surface
  // reachable by link alone.
  const errorMessage =
    searchParams.error && searchParams.error in CAPTURE_ERRORS
      ? CAPTURE_ERRORS[searchParams.error as CaptureErrorCode]
      : null;

  const action = startBookingIntent.bind(null, params.slug);
  const subject = offering?.title ?? bookingLink?.label ?? null;

  return (
    <main className="mx-auto max-w-lg px-4 py-10 sm:py-14">
      <Link
        href={`/practitioners/${practitioner.slug}`}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        Back to {practitioner.displayName}
      </Link>

      <Card className="mt-4 space-y-4 p-6 sm:p-8">
        <div className="space-y-1">
          <h1 className="text-base font-semibold">
            Book with {practitioner.displayName}
          </h1>
          <p className="text-xs text-muted-foreground">
            {subject
              ? `${subject} — first, how can they reach you?`
              : 'First, how can they reach you?'}
          </p>
        </div>

        {errorMessage && (
          <p
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
          >
            {errorMessage}
          </p>
        )}

        <form action={action} className="space-y-3">
          {/* Echoed back so a validation bounce cannot lose the buyer's entry context. Both are
              re-resolved server-side against this practitioner — never trusted from here. */}
          {bookingLink && <input type="hidden" name="bookingLinkId" value={bookingLink.id} />}
          {offering && <input type="hidden" name="offeringId" value={offering.id} />}

          <label className="block space-y-1">
            <span className="text-xs font-medium">Your name</span>
            <input
              type="text"
              name="name"
              required
              maxLength={CAPTURE_LIMITS.name}
              defaultValue={searchParams.name ?? ''}
              autoComplete="name"
              className="h-10 w-full rounded-md border bg-card px-3 text-sm outline-none ring-ring/30 focus-visible:ring-2"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-medium">Email</span>
            <input
              type="email"
              name="email"
              required
              maxLength={CAPTURE_LIMITS.email}
              defaultValue={searchParams.email ?? ''}
              autoComplete="email"
              className="h-10 w-full rounded-md border bg-card px-3 text-sm outline-none ring-ring/30 focus-visible:ring-2"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-medium">
              Phone <span className="font-normal text-muted-foreground">(optional)</span>
            </span>
            <input
              type="tel"
              name="phone"
              maxLength={CAPTURE_LIMITS.phone}
              defaultValue={searchParams.phone ?? ''}
              autoComplete="tel"
              className="h-10 w-full rounded-md border bg-card px-3 text-sm outline-none ring-ring/30 focus-visible:ring-2"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-medium">
              Anything they should know?{' '}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </span>
            <textarea
              name="note"
              rows={3}
              maxLength={CAPTURE_LIMITS.note}
              defaultValue={searchParams.note ?? ''}
              className="w-full rounded-md border bg-card px-3 py-2 text-sm outline-none ring-ring/30 focus-visible:ring-2"
            />
          </label>

          {/* Four fields, deliberately. This is lead capture, NOT intake — the practitioner's own
              scheduler asks its own questions at the next step, and §6 forbids duplicating them. */}
          {/* The repo's existing pending primitive rather than a second copy of it — it also
              sets aria-busy, which a bespoke duplicate dropped. */}
          <PendingButton
            pendingLabel="Saving your details…"
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            Continue
          </PendingButton>
        </form>
      </Card>
    </main>
  );
}
