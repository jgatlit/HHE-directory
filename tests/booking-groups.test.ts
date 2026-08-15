import { describe, it, expect } from 'vitest';
import { groupBookings, type GroupableBooking } from '@/lib/booking-groups';

/**
 * These exist because reverting the dashboard to hide paid bookings was INVISIBLE: the mutation
 * passed tsc, lint and all 302 tests, while making a collected booking and a deleted one look
 * identical from the practitioner's side.
 */
function row(over: Partial<GroupableBooking> = {}): GroupableBooking {
  return {
    status: 'SCHEDULED',
    paidAt: null,
    paymentsLive: true,
    offeringPriceUsdCents: 5500,
    ...over,
  };
}

describe('groupBookings', () => {
  it('shows a paid booking rather than dropping it', () => {
    const paid = row({ paidAt: new Date(), status: 'PAID' });
    const g = groupBookings([paid]);
    // The regression: a paid row silently vanishing so the dashboard cannot be trusted.
    expect(g.paid).toEqual([paid]);
    expect(g.awaitingPayment).toEqual([]);
  });

  // paidAt is the webhook's write and the authority; status can lag it for a moment. A paid row
  // shown as outstanding sends a practitioner chasing money they already have.
  it('treats paidAt as the authority even when status still says SCHEDULED', () => {
    const lagging = row({ paidAt: new Date(), status: 'SCHEDULED' });
    const g = groupBookings([lagging]);
    expect(g.paid).toEqual([lagging]);
    expect(g.awaitingPayment).toEqual([]);
    expect(g.booked).toEqual([]);
  });

  it('puts an unpaid scheduled booking with a live checkout under payment outstanding', () => {
    const r = row();
    expect(groupBookings([r]).awaitingPayment).toEqual([r]);
  });

  it.each([
    ['a free consultation', { offeringPriceUsdCents: 0 }],
    ['an off-platform sale', { paymentsLive: false }],
    ['no offering at all', { offeringPriceUsdCents: null }],
  ])('never says payment is outstanding for %s', (_label, over) => {
    const r = row(over as Partial<GroupableBooking>);
    const g = groupBookings([r]);
    expect(g.awaitingPayment).toEqual([]);
    expect(g.booked).toEqual([r]);
  });

  it.each(['PENDING', 'ABANDONED'] as const)('files a %s intent as a lead', (status) => {
    const r = row({ status });
    const g = groupBookings([r]);
    expect(g.leads).toEqual([r]);
    expect(g.awaitingPayment).toEqual([]);
  });

  it('places every row in exactly one group', () => {
    const rows = [
      row(),
      row({ paidAt: new Date(), status: 'PAID' }),
      row({ status: 'PENDING' }),
      row({ status: 'ABANDONED' }),
      row({ offeringPriceUsdCents: 0 }),
    ];
    const g = groupBookings(rows);
    const total = g.awaitingPayment.length + g.booked.length + g.paid.length + g.leads.length;
    // A row falling through every filter would disappear from the dashboard with nothing failing.
    expect(total).toBe(rows.length);
  });
});
