export type OfferingFieldInput = {
  /** Presence, not value — an unchecked checkbox posts nothing at all. */
  isConsult: boolean;
  acceptsPayments: boolean;
  showOnProfile: boolean;
  rawDuration: string;
  /** Already resolved against THIS practitioner's links by the caller; null if not owned. */
  ownedBookingLinkId: string | null;
};

export type OfferingFieldValues = {
  isConsult: boolean;
  acceptsPayments: boolean;
  duration: number | null;
  bookingLinkId: string | null;
  listingVisibility: 'LISTED' | 'LINK_ONLY';
  /** Non-null forces the stored price, overriding whatever the form posted. */
  priceOverride: number | null;
};

/**
 * Normalise the §12 offering controls and re-establish §2's invariants.
 *
 * Extracted from the server action so it can be tested directly: a `'use server'` module may only
 * export async server actions, so a pure helper cannot live there. Same reason `parseBookingLinkRows`
 * lives in `booking-links.ts`.
 *
 * The editor already enforces all of this by construction, but that is a property of the UI and a
 * crafted POST does not go through the UI. Two of these invariants are also backed by a DB CHECK,
 * and a CHECK violation surfaces as a 500 rather than a graceful redirect — so they are
 * re-established here, where they can be applied silently and correctly.
 *
 * The booking-link OWNERSHIP check is deliberately NOT here: it needs a scoped database query, and
 * the caller passes the already-resolved id. Keeping the impure half out is what makes the rest
 * of the rules testable without a database.
 */
export function normalizeOfferingFields(input: OfferingFieldInput): OfferingFieldValues {
  const { isConsult, ownedBookingLinkId } = input;

  const parsed = input.rawDuration.trim() ? Number.parseInt(input.rawDuration.trim(), 10) : NaN;
  const duration = Number.isFinite(parsed) && parsed > 0 ? parsed : null;

  return {
    isConsult,
    // D2 — payment is not "unavailable" for a free consult, it is meaningless.
    acceptsPayments: isConsult ? false : input.acceptsPayments,
    duration,
    bookingLinkId: ownedBookingLinkId,
    // LINK_ONLY without a link is unrepresentable (§2): an Offering hidden from the grid and
    // attached to no chooser is reachable from nowhere at all. Fall back to LISTED rather than
    // letting the DB CHECK throw on a save the practitioner never intended.
    listingVisibility: !input.showOnProfile && ownedBookingLinkId ? 'LINK_ONLY' : 'LISTED',
    // A free consult is price 0 by definition, and its price input is disabled — so it posts
    // nothing and must not be allowed to inherit a stale value.
    priceOverride: isConsult ? 0 : null,
  };
}
