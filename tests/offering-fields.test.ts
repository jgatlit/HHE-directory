import { describe, it, expect } from 'vitest';
import { normalizeOfferingFields, type OfferingFieldInput } from '@/lib/offering-fields';

const base: OfferingFieldInput = {
  isConsult: false,
  acceptsPayments: false,
  showOnProfile: true,
  rawDuration: '',
  ownedBookingLinkId: null,
};
const f = (o: Partial<OfferingFieldInput> = {}) => normalizeOfferingFields({ ...base, ...o });

describe('D2 — a free consult forces price and payments off', () => {
  it('zeroes the price via priceOverride, so a disabled input cannot inherit a stale value', () => {
    expect(f({ isConsult: true }).priceOverride).toBe(0);
    expect(f({ isConsult: false }).priceOverride).toBeNull();
  });

  it('forces acceptsPayments off even when the payload says otherwise', () => {
    // The UI disables this checkbox, but a crafted POST does not go through the UI.
    expect(f({ isConsult: true, acceptsPayments: true }).acceptsPayments).toBe(false);
  });

  it('leaves acceptsPayments alone for a normal paid offering', () => {
    expect(f({ acceptsPayments: true }).acceptsPayments).toBe(true);
  });
});

describe('§2 — LINK_ONLY is unrepresentable without a booking link', () => {
  // This is the invariant the DB CHECK backs. Reaching the CHECK means a 500 instead of a
  // graceful save, so it must be normalised away before the write.
  it('falls back to LISTED when hidden is requested with NO link', () => {
    expect(f({ showOnProfile: false, ownedBookingLinkId: null }).listingVisibility).toBe('LISTED');
  });

  it('honours LINK_ONLY when a link IS attached', () => {
    expect(f({ showOnProfile: false, ownedBookingLinkId: 'bl_1' }).listingVisibility).toBe('LINK_ONLY');
  });

  it('stays LISTED when shown, link or not', () => {
    expect(f({ showOnProfile: true, ownedBookingLinkId: 'bl_1' }).listingVisibility).toBe('LISTED');
    expect(f({ showOnProfile: true }).listingVisibility).toBe('LISTED');
  });

  it('a free consult hidden behind a link is the §4 case, and is allowed', () => {
    const r = f({ isConsult: true, showOnProfile: false, ownedBookingLinkId: 'bl_1' });
    expect(r.listingVisibility).toBe('LINK_ONLY');
    expect(r.priceOverride).toBe(0);
  });
});

describe('booking link ownership', () => {
  it('persists only the id the caller resolved as owned', () => {
    // A non-owned id arrives here as null — the scoped query in the action is what drops it, and
    // this asserts the pure half never resurrects one.
    expect(f({ ownedBookingLinkId: null }).bookingLinkId).toBeNull();
    expect(f({ ownedBookingLinkId: 'bl_mine' }).bookingLinkId).toBe('bl_mine');
  });
});

describe('duration parsing', () => {
  it.each([
    ['60', 60],
    ['  90 ', 90],
    ['', null],
    ['abc', null],
    ['0', null],
    ['-30', null],
  ])('%s → %s', (raw, expected) => {
    expect(f({ rawDuration: raw }).duration).toBe(expected);
  });
});
