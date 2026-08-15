export type CtaOffering = {
  id: string;
  title: string;
  priceUsdCents: number;
  isConsult: boolean;
  bookingLinkId: string | null;
  listingVisibility: 'LISTED' | 'LINK_ONLY';
};

export type CtaBookingLink = {
  id: string;
  label: string | null;
  url: string;
  ctaLabel: string | null;
};

/**
 * Offerings attached to one Booking Link — the chooser's membership set (§14.1).
 *
 * Deliberately ignores `listingVisibility`: §4 requires the chooser to list ALL Offerings
 * pointing at the link REGARDLESS of it, and that is the single property that makes an unlisted
 * free consult reachable there and nowhere else. Two distinct layers — `listingVisibility` gates
 * the profile grid, `bookingLinkId` gates chooser membership.
 *
 * ⚠️ Never filter this on `WhopProduct.active`. It looks like the visibility flag and is not: it
 * was applied in the profile query itself, so anything it excluded never entered the loaded set
 * and would vanish from the chooser too. (It is also dead — read but never written.)
 */
export function offeringsForLink(offerings: CtaOffering[], linkId: string): CtaOffering[] {
  return offerings.filter((o) => o.bookingLinkId === linkId);
}

/**
 * Which Booking Link, if any, gets the hero slot (§14.3).
 *
 * A designated primary always wins. With none designated, a SINGLE link is unambiguous and is
 * promoted; with several, the hero is SUPPRESSED and Offering cards lead — in that topology the
 * cards are the correct entry point, and a hero pointing at one arbitrary calendar would
 * misrepresent the practice.
 *
 * Note this is not the same rule as "a link with zero Offerings is unconfigured". A booking link
 * with no linked Offerings still renders and is schedulable; suppression here is about which of
 * SEVERAL links deserves the hero, never about whether a link is usable.
 */
export function resolveHeroLink(
  links: CtaBookingLink[],
  primaryBookingLinkId: string | null,
): CtaBookingLink | null {
  if (links.length === 0) return null;
  const designated = primaryBookingLinkId
    ? links.find((l) => l.id === primaryBookingLinkId)
    : undefined;
  if (designated) return designated;
  return links.length === 1 ? links[0]! : null;
}

/**
 * Public button text for a Booking Link (§4).
 *
 * Defaults to "Book a free consultation" when a zero-price Offering is attached, "Book now"
 * otherwise; the practitioner's own `ctaLabel` always wins. The default matters most in the case
 * it was written for: when the free consult is LINK_ONLY, this button is the ONLY signal it
 * exists anywhere on the profile.
 */
export function ctaLabelFor(link: CtaBookingLink, linked: CtaOffering[]): string {
  const override = link.ctaLabel?.trim();
  if (override) return override;
  const hasFree = linked.some((o) => o.isConsult || o.priceUsdCents === 0);
  return hasFree ? 'Book a free consultation' : 'Book now';
}

/**
 * Display name for a Booking Link (§4 label defaulting).
 *
 * With exactly one Offering linked, borrow that Offering's title so the link and the card read as
 * one thing rather than two unrelated entries. With several there is no single title to borrow.
 */
export function linkDisplayLabel(link: CtaBookingLink, linked: CtaOffering[]): string {
  const own = link.label?.trim();
  if (own) return own;
  if (linked.length === 1) return linked[0]!.title;
  return 'Book a session';
}

/**
 * Where a Booking Link CTA sends the buyer (§4 entry-point routing).
 *
 * 0 linked → straight into the flow with no Offering. This is a SUPPORTED entry point, not an
 *            unconfigured one: capture → schedule → done, with checkout skipped because there is
 *            nothing to charge for.
 * 1 linked → straight in carrying that Offering, so the fast path for a decided buyer survives.
 * 2+       → chooser, expanded ON THE PROFILE. Intent is "book with this practitioner", not yet
 *            "book this thing" — and keeping the choice on the profile preserves the
 *            decided-buyer property rather than turning it into a step inside the flow.
 */
export function bookingLinkTarget(
  slug: string,
  link: CtaBookingLink,
  linked: CtaOffering[],
): { kind: 'chooser' } | { kind: 'flow'; href: string } {
  if (linked.length > 1) return { kind: 'chooser' };
  const params = new URLSearchParams({ link: link.id });
  if (linked.length === 1) params.set('offering', linked[0]!.id);
  return { kind: 'flow', href: `/practitioners/${encodeURIComponent(slug)}/book?${params}` };
}

/**
 * Where an Offering card's inner action sends the buyer.
 *
 * NEVER a chooser (§4): the buyer has already expressed which Offering they want, and
 * re-presenting a menu containing a free option cannibalises a decided buyer.
 */
export function offeringTarget(slug: string, offering: CtaOffering): string {
  const params = new URLSearchParams({ offering: offering.id });
  if (offering.bookingLinkId) params.set('link', offering.bookingLinkId);
  return `/practitioners/${encodeURIComponent(slug)}/book?${params}`;
}

/**
 * A chooser option's destination. Extracted because both chooser render paths were building this
 * literal by hand — the only untested URL construction in the feature, and the two places most
 * likely to drift from the helpers when a query param is added.
 */
export function chooserOptionTarget(slug: string, linkId: string, offeringId: string): string {
  const params = new URLSearchParams({ link: linkId, offering: offeringId });
  return `/practitioners/${encodeURIComponent(slug)}/book?${params}`;
}
