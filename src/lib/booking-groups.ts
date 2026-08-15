/**
 * How the practitioner's Bookings dashboard is divided (§10, §11).
 *
 * Extracted from the component because reverting it is INVISIBLE to every other check: the query
 * and the grouping both type-check whether or not paid rows are included, and a mutation that
 * dropped paid bookings from the dashboard entirely passed `tsc`, `lint` and the whole suite.
 * The rules are the thing worth asserting, so they live somewhere assertable.
 */

export type GroupableBooking = {
  status: 'PENDING' | 'SCHEDULED' | 'PAID' | 'ABANDONED';
  /** Written by the payment webhook — the authority for payment. */
  paidAt: Date | null;
  /** §9's three-way AND, resolved by the caller: was there ever a checkout for this intent? */
  paymentsLive: boolean;
  offeringPriceUsdCents: number | null;
};

export type BookingGroups<T> = {
  /** The §10 obligation: a client holds a slot and has not paid. */
  awaitingPayment: T[];
  /** Scheduled with nothing owed — free consults and off-platform sales. */
  booked: T[];
  /** Money landed. Shown so a row leaving `awaitingPayment` means something visible happened. */
  paid: T[];
  /** Captured, never got as far as a calendar. */
  leads: T[];
};

export function groupBookings<T extends GroupableBooking>(rows: T[]): BookingGroups<T> {
  // PAID IS DECIDED FIRST, AND ON `paidAt` — not on `status`. paidAt is what the webhook writes;
  // status can lag it for a moment, and a paid row appearing under "payment outstanding" in that
  // window would send a practitioner chasing money they already have.
  const paid = rows.filter((r) => r.paidAt !== null);
  const unpaid = rows.filter((r) => r.paidAt === null);

  // A checkout has to have existed for anything to be outstanding. A free consult or an
  // off-platform sale owes nothing, however long it sits.
  const awaitingPayment = unpaid.filter(
    (r) => r.status === 'SCHEDULED' && r.paymentsLive && (r.offeringPriceUsdCents ?? 0) > 0,
  );
  const owed = new Set<T>(awaitingPayment);
  const booked = unpaid.filter((r) => r.status === 'SCHEDULED' && !owed.has(r));
  const leads = unpaid.filter((r) => r.status === 'PENDING' || r.status === 'ABANDONED');

  return { awaitingPayment, booked, paid, leads };
}
