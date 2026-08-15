import { describe, it, expect } from 'vitest';
import { formatPrice, intervalSuffix, actionLabel } from '@/lib/money';

describe('formatPrice — one formatter, because four copies had already drifted', () => {
  it.each([
    [5500, '$55'],
    [15050, '$150.50'],
    [0, '$0'],
    [99, '$0.99'],
  ])('%d → %s', (cents, expected) => {
    expect(formatPrice(cents)).toBe(expected);
  });
});

describe('intervalSuffix — ANNUAL was previously unhandled', () => {
  it('distinguishes a yearly membership from a one-time package of the same price', () => {
    // Without this a $1,200/yr membership rendered as a bare "$1200".
    expect(intervalSuffix('ANNUAL')).toBe('/yr');
    expect(intervalSuffix('MONTHLY')).toBe('/mo');
    expect(intervalSuffix('ONE_TIME')).toBeNull();
  });
});

describe('actionLabel — a recurring charge must say so before checkout', () => {
  it('says Subscribe for recurring, Book now for one-time', () => {
    const base = { canTransact: true, priceUsdCents: 5500 } as const;
    expect(actionLabel({ ...base, interval: 'ONE_TIME' })).toBe('Book now');
    expect(actionLabel({ ...base, interval: 'MONTHLY' })).toBe('Subscribe');
    expect(actionLabel({ ...base, interval: 'ANNUAL' })).toBe('Subscribe');
  });

  it('never promises a purchase that cannot transact (§9)', () => {
    expect(actionLabel({ interval: 'ONE_TIME', canTransact: false, priceUsdCents: 5500 })).toBe(
      'Request a time',
    );
    expect(actionLabel({ interval: 'MONTHLY', canTransact: true, priceUsdCents: 0 })).toBe(
      'Request a time',
    );
  });
});
