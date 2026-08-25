import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { CheckCircle2, Pencil } from 'lucide-react';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { OFFERING_ORDER, SPECIALTY_ORDER } from '@/lib/practitioner-ordering';
import { paymentsLive } from '@/lib/booking-flow';
import { offeringTarget } from '@/lib/profile-ctas';
import { OfferingCard } from '@/components/practitioners/OfferingCard';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { PractitionerHero } from '@/components/practitioners/PractitionerHero';
import { PractitionerCTAs } from '@/components/practitioners/PractitionerCTAs';

type PageProps = { params: { slug: string }; searchParams: { onboarded?: string } };

async function loadPractitioner(slug: string) {
  return prisma.practitioner.findUnique({
    where: { slug },
    include: {
      city: true,
      specialties: { include: { specialty: true }, orderBy: SPECIALTY_ORDER },
      bookingLinks: { orderBy: { sortOrder: 'asc' } },
      caseStudies: { orderBy: { createdAt: 'desc' } },
      // No `active` filter: that column is dead and was a trap — it reads like a hidden/visible
      // toggle and is not one, and because it filtered HERE it would have removed an Offering
      // from every public surface at once, chooser included, with no UI to explain why.
      //
      // `archived` IS kept. It stays the natural home for soft-delete (hard-deleting an Offering
      // with BookingIntent rows pointing at it is its own problem), and the dashboard and admin
      // both already filter on it — dropping it here alone would let an archived Offering show
      // publicly while hidden from its own owner.
      //
      // NOT filtered on listingVisibility. The grid and the chooser need different subsets, and
      // filtering here would strip LINK_ONLY offerings before the chooser could see them —
      // destroying the one property that makes an unlisted free consult reachable (§4).
      // Partitioned below: listingVisibility gates the grid, bookingLinkId gates the chooser.
      whopProducts: { where: { archived: false }, orderBy: OFFERING_ORDER },
    },
  });
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const p = await loadPractitioner(params.slug);
  if (!p) return { title: 'Practitioner not found' };
  const descr = p.whoIHelp || p.headline || p.bio || undefined;
  return {
    title: `${p.displayName}${p.headline ? ` — ${p.headline}` : ''} · Natural Health Pros`,
    description: descr?.slice(0, 200),
  };
}

export default async function PractitionerPage({ params, searchParams }: PageProps) {
  const p = await loadPractitioner(params.slug);
  if (!p) notFound();

  // The owner needs a way back to their dashboard from their own public page. Before this, the
  // dashboard link rendered ONLY behind ?onboarded — so once that first redirect was gone, the
  // practitioner had to hand-type "/edit" onto the URL. Sarah Schindler had to be walked through
  // exactly that on the 2026-08-11 call ("that's how you can get to it right now… that's another
  // item for my list"). Viewer-only: this never renders for the public.
  const session = await auth();
  const canEdit =
    !!session?.user &&
    (session.user.id === p.userId || session.user.role === 'ADMIN');

  // Dual-label: canonical names = curated rail chips; rawLabels = the practitioner's own
  // phrasing, listed under "Specialties". Parent rollups excluded from the chip set to keep it tight.
  const canonicalChips = Array.from(new Set(p.specialties.map((ps) => ps.specialty.name)));
  const rawModalities = Array.from(
    new Set(p.specialties.map((ps) => ps.rawLabel?.trim()).filter((l): l is string => !!l)),
  );

  // Two layers, deliberately (§4, D3):
  //   listingVisibility → what the public GRID shows
  //   bookingLinkId     → what a Booking Link's CHOOSER offers, visibility ignored
  // One boolean could never express both, which is why `active` was the wrong tool for this.
  const ctaOfferings = p.whopProducts.map((o) => ({
    id: o.id,
    title: o.title,
    priceUsdCents: o.priceUsdCents,
    isConsult: o.isConsult,
    bookingLinkId: o.bookingLinkId,
    listingVisibility: o.listingVisibility,
  }));
  // Precomputed once per offering: paymentsLive was being evaluated twice with identical
  // arguments and the CtaOffering literal rebuilt inline, so the mapping existed in two places
  // that could drift.
  const gridOfferings = p.whopProducts
    .filter((o) => o.listingVisibility === 'LISTED')
    .map((o) => {
      const canTransact =
        paymentsLive({
          acceptsPayments: o.acceptsPayments,
          practitionerPayoutsEnabled: p.whopPayoutsEnabled,
          whopPlanId: o.whopPlanId,
        }) && o.purchaseUrl != null;
      // purchaseUrl is required, not incidental: the flow's checkout step reads it, so an
      // offering with a plan id but no checkout URL would render a confident action that lands
      // the buyer on "will be in touch" with no payment path. The old code deliberately left
      // such an offering unbuttoned rather than broken-looking.
      const actionable = o.bookingLinkId != null || canTransact;
      return {
        ...o,
        canTransact,
        href: actionable ? offeringTarget(p.slug, { ...o }) : null,
      };
    });

  return (
    <main className="min-h-screen bg-muted/30 px-4 py-10 sm:py-16">
      <div className="mx-auto max-w-4xl space-y-4">
        {searchParams.onboarded && (
          <Card className="flex flex-col items-start gap-3 border-primary/30 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" aria-hidden />
              <span>
                <strong>Your page is live.</strong> Edit anything — bio, offerings, booking links —
                anytime in your dashboard.
              </span>
            </p>
            <Link
              href={`/practitioners/${params.slug}/edit`}
              className="inline-flex h-9 shrink-0 items-center justify-center rounded-md bg-primary px-4 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Go to dashboard
            </Link>
          </Card>
        )}
        {canEdit && !searchParams.onboarded && (
          <div className="flex justify-end">
            <Link
              href={`/practitioners/${params.slug}/edit`}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border bg-card px-4 text-xs font-medium transition-colors hover:bg-accent/40"
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden />
              Edit my profile
            </Link>
          </div>
        )}
        <Card className="p-6 sm:p-12">
          <div className="grid gap-12 sm:grid-cols-[22rem_1fr]">
            {/* Sticky identity + booking rail (Variation B) */}
            <aside className="min-w-0 space-y-6 sm:sticky sm:top-8 sm:self-start">
              <PractitionerHero
                displayName={p.displayName}
                headline={p.headline}
                photoUrl={p.photoUrl}
                city={p.city ? { name: p.city.name, state: p.city.state } : null}
                telehealth={p.telehealth}
                inPerson={p.inPerson}
                yearsInPractice={p.yearsInPractice}
                chips={canonicalChips}
                hheCertified={p.hheCertified}
              />
              <PractitionerCTAs
                slug={p.slug}
                bookingLinks={p.bookingLinks.map((b) => ({
                  id: b.id,
                  label: b.label,
                  url: b.url,
                  ctaLabel: b.ctaLabel,
                }))}
                // EVERY non-archived offering, listingVisibility included: chooser membership is
                // gated by bookingLinkId, never by visibility (§4).
                offerings={ctaOfferings}
                primaryBookingLinkId={p.primaryBookingLinkId}
                websiteUrl={p.websiteUrl}
              />
            </aside>

            {/* Scrollable narrative */}
            <div className="min-w-0 space-y-6">
              {/* Hook sits at the top of the narrative column, directly above whoIHelp. The
                  credential line (headline) stays with the identity rail on the left, so the two
                  read as distinct registers rather than two titles stacked together. */}
              {p.tagline && (
                <p className="font-serif text-2xl leading-snug tracking-tight text-primary">
                  {p.tagline}
                </p>
              )}

              {p.whoIHelp && (
                <p className="text-lg leading-relaxed text-foreground">{p.whoIHelp}</p>
              )}

              {p.bio && (
                <section
                  aria-label="About"
                  className="space-y-2 rounded-xl bg-secondary/40 p-6"
                >
                  <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    About {p.displayName.split(/\s+/)[0]}
                  </h2>
                  <div className="space-y-3 text-sm leading-relaxed text-foreground">
                    {p.bio.split(/\n{2,}/).map((para, i) => (
                      <p key={i}>{para.trim()}</p>
                    ))}
                  </div>
                </section>
              )}

              {/* Heading is "Specialties", not "How I work": this section renders the
                  practitioner's own specialty phrasing, and the old title misdescribed it.
                  Sarah Schindler, reviewing her own page 2026-08-11: "the How I Work title
                  doesn't fit in with the… I get the specialties, but the How I Work doesn't." */}
              {rawModalities.length > 0 && (
                <section
                  aria-label="Specialties"
                  className="space-y-2 rounded-xl bg-secondary/40 p-6"
                >
                  <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Specialties
                  </h2>
                  <ul className="divide-y rounded-lg border bg-card">
                    {rawModalities.map((m) => (
                      <li key={m} className="px-3 py-2.5 text-sm">
                        {m}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {gridOfferings.length > 0 && (
                <section
                  aria-label="Offerings"
                  className="space-y-3 rounded-xl bg-secondary/40 p-6"
                >
                  <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Offerings
                  </h2>
                  <ul className="space-y-2.5">
                    {gridOfferings.map((o) => (
                      <OfferingCard
                        key={o.id}
                        title={o.title}
                        description={o.description}
                        priceUsdCents={o.priceUsdCents}
                        interval={o.interval}
                        category={o.category}
                        duration={o.duration}
                        // Straight into the flow — never a chooser (§4). Null only when there is
                        // genuinely nothing to act on: no calendar and no live checkout.
                        href={o.href}
                        canTransact={o.canTransact}
                      />
                    ))}
                  </ul>
                </section>
              )}

              {p.caseStudies.length > 0 && (
                <section
                  aria-label="Outcomes"
                  className="space-y-3 rounded-xl bg-secondary/40 p-6"
                >
                  <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Outcomes
                  </h2>
                  <ul className="space-y-3">
                    {p.caseStudies.map((cs) => (
                      <li key={cs.id} className="rounded-lg border bg-card p-4">
                        <p className="text-sm font-medium">{cs.title}</p>
                        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                          {cs.summary}
                        </p>
                        {cs.outcome && (
                          <p className="mt-1 text-sm leading-relaxed text-foreground">{cs.outcome}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* Queue item 8 (2026-08-25) — coming-soon placeholder ONLY. Reviews aren't built:
                  Jonathan deferred them on the 08-18 call until there's "a critical mass of
                  practitioners using Google reviews" to plug into instead of building a bespoke
                  system now. Case studies/manual testimonials are a separate, buildable-now piece
                  still blocked on Amy's authenticity policy — this section is about neither of
                  those, just the plain fact that reviews are coming.
                  Deliberately informational, not a button or a greyed-out tile: the 08-11 call's
                  A4 ruling removed a similar-looking disabled-tile CTA pattern for reading as
                  broken on a live profile. No click target, no disabled state — just a quiet,
                  permanent note next to whatever else this section of the page is showing. */}
              <section
                aria-label="Reviews"
                className="rounded-xl bg-secondary/40 p-6 text-center text-xs text-muted-foreground"
              >
                Client reviews are coming to Natural Health Pros soon.
              </section>
            </div>
          </div>

          <Separator className="my-8" />
          <p className="text-center text-xs text-muted-foreground">
            HHE-curated practitioner · invite-only directory
          </p>
        </Card>
      </div>
    </main>
  );
}
