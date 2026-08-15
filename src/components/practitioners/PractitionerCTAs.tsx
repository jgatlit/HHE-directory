import Link from 'next/link';
import { Calendar, Globe, ChevronRight } from 'lucide-react';
import {
  resolveHeroLink,
  offeringsForLink,
  ctaLabelFor,
  linkDisplayLabel,
  bookingLinkTarget,
  type CtaBookingLink,
  type CtaOffering,
} from '@/lib/profile-ctas';
import { chooserOptionTarget } from '@/lib/profile-ctas';
import { BookingChooser } from '@/components/practitioners/BookingChooser';

type Props = {
  slug: string;
  bookingLinks?: CtaBookingLink[];
  /** Every non-archived offering — chooser membership ignores listingVisibility (§4). */
  offerings?: CtaOffering[];
  primaryBookingLinkId?: string | null;
  websiteUrl?: string | null;
};

function hostHint(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'Open link';
  }
}

/**
 * Booking rail — the DECIDED buyer's surface (§4).
 *
 * Decided to ACT, not decided to BUY, which is why a free consult belongs here. The job of these
 * CTAs is to get out of the way; the Offering cards below do the selling.
 *
 * Every CTA now enters the on-page flow instead of opening the practitioner's scheduler in a new
 * tab. That new-tab behaviour was T3 — the last-resort tier — and it was what shipped for every
 * practitioner, so this is the first time the on-page requirement is actually met.
 */
export function PractitionerCTAs({
  slug,
  bookingLinks = [],
  offerings = [],
  primaryBookingLinkId,
  websiteUrl,
}: Props) {
  const hero = resolveHeroLink(bookingLinks, primaryBookingLinkId ?? null);
  const secondary = bookingLinks.filter((l) => l.id !== hero?.id);

  return (
    <section aria-label="Book & connect" className="space-y-3">
      {hero ? (
        <HeroCta slug={slug} link={hero} offerings={offerings} />
      ) : bookingLinks.length > 0 ? (
        // §14.3 hero suppression: several links, none designated. The cards lead instead — a hero
        // pointing at one arbitrary calendar would misrepresent the practice. The links
        // themselves still render below; only the hero SLOT is suppressed.
        <p className="rounded-lg border border-dashed bg-card p-3 text-xs text-muted-foreground">
          Choose what you&apos;d like to book below.
        </p>
      ) : (
        <div
          className="flex items-center gap-3 rounded-lg border border-dashed bg-card p-4 opacity-70"
          aria-disabled
        >
          <Calendar className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Booking coming soon</p>
            <p className="text-xs text-muted-foreground">Reach out via their website below</p>
          </div>
        </div>
      )}

      {secondary.map((b) => (
        <SecondaryCta key={b.id} slug={slug} link={b} offerings={offerings} />
      ))}

      {websiteUrl && (
        <a
          href={websiteUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="group flex items-center gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-accent/40"
        >
          <Globe className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">Visit website</p>
            <p className="truncate text-xs text-muted-foreground">{hostHint(websiteUrl)}</p>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        </a>
      )}
    </section>
  );
}

function HeroCta({
  slug,
  link,
  offerings,
}: {
  slug: string;
  link: CtaBookingLink;
  offerings: CtaOffering[];
}) {
  const linked = offeringsForLink(offerings, link.id);
  const target = bookingLinkTarget(slug, link, linked);
  const label = ctaLabelFor(link, linked);

  if (target.kind === 'chooser') {
    return (
      <BookingChooser
        ctaLabel={label}
        subLabel={`${linked.length} options`}
        options={linked.map((o) => ({
          id: o.id,
          title: o.title,
          priceUsdCents: o.priceUsdCents,
          href: chooserOptionTarget(slug, link.id, o.id),
        }))}
      />
    );
  }

  return (
    <Link
      href={target.href}
      className="group flex items-center gap-3 rounded-lg bg-cta p-4 text-cta-foreground transition-opacity hover:opacity-90"
    >
      <Calendar className="h-5 w-5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{label}</p>
        <p className="truncate text-xs opacity-80">{linkDisplayLabel(link, linked)}</p>
      </div>
      <ChevronRight
        className="h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5"
        aria-hidden
      />
    </Link>
  );
}

function SecondaryCta({
  slug,
  link,
  offerings,
}: {
  slug: string;
  link: CtaBookingLink;
  offerings: CtaOffering[];
}) {
  const linked = offeringsForLink(offerings, link.id);
  const target = bookingLinkTarget(slug, link, linked);

  if (target.kind === 'chooser') {
    return (
      <BookingChooser
        ctaLabel={ctaLabelFor(link, linked)}
        subLabel={`${linked.length} options`}
        options={linked.map((o) => ({
          id: o.id,
          title: o.title,
          priceUsdCents: o.priceUsdCents,
          href: chooserOptionTarget(slug, link.id, o.id),
        }))}
      />
    );
  }

  return (
    <Link
      href={target.href}
      className="group flex items-center gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-accent/40"
    >
      <Calendar className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{linkDisplayLabel(link, linked)}</p>
        <p className="truncate text-xs text-muted-foreground">{hostHint(link.url)}</p>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}

