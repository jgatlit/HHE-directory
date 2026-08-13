import { describe, it, expect } from 'vitest';
import { parseBookingLinkRows } from '@/lib/booking-links';

/**
 * Guards the zip/dedupe rules behind in-place booking-link reconciliation.
 *
 * The invariant every test here defends is the same one: a row that already exists in the
 * database must keep its id across a save. `Offering.bookingLinkId` and the practitioner's
 * designated hero CTA both point at that id, so a row silently swapping identity takes those
 * references with it — and it does so without any error, which is why it needs tests rather
 * than review attention.
 */

// Stand-in for normalizeBookingUrl: lowercases host, strips a leading www., drops a trailing
// slash. Enough to make two spellings of one scheduler collide, which is the interesting case.
const normalize = (raw: string): string | null => {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return `https://${u.hostname.toLowerCase().replace(/^www\./, '')}${u.pathname.replace(/\/$/, '')}`;
  } catch {
    return null;
  }
};

const rows = (ids: string[], labels: string[], urls: string[]) =>
  parseBookingLinkRows({ ids, labels, urls }, normalize);

describe('parseBookingLinkRows', () => {
  it('zips the three arrays by index and preserves order', () => {
    const out = rows(
      ['X', ''],
      ['Free intro', 'Deep dive'],
      ['https://cal.com/a', 'https://cal.com/b'],
    );
    expect(out).toEqual([
      { id: 'X', label: 'Free intro', url: 'https://cal.com/a' },
      { id: null, label: 'Deep dive', url: 'https://cal.com/b' },
    ]);
  });

  it('treats an emptied URL as a removed row, dropping its id from the keep set', () => {
    // The id must NOT survive — the reconcile keys deletion off absence from this list, so
    // returning it would resurrect a link the practitioner just cleared.
    const out = rows(['X', 'Y'], ['a', 'b'], ['https://cal.com/a', '   ']);
    expect(out).toEqual([{ id: 'X', label: 'a', url: 'https://cal.com/a' }]);
  });

  it('returns null on an unnormalisable URL so the caller can redirect', () => {
    expect(rows([''], ['a'], ['not a url'])).toBeNull();
    expect(rows([''], ['a'], ['javascript:alert(1)'])).toBeNull();
  });

  it('REGRESSION: a duplicate id-less row must not displace a persisted identity', () => {
    // Reachable in ordinary use: add a row, paste a URL you already use, drag it above the
    // original. First-occurrence-wins would keep the id-less row, so the persisted row gets
    // deleted and recreated — the exact id churn in-place reconciliation exists to remove.
    const out = rows(
      ['', 'Y'],
      ['new row', 'original'],
      ['https://cal.com/same', 'https://cal.com/same'],
    );
    expect(out).toHaveLength(1);
    expect(out![0].id).toBe('Y');
  });

  it('adopts the persisted id even when the spellings differ', () => {
    const out = rows(['', 'Y'], ['new', 'orig'], ['https://www.cal.com/same/', 'https://cal.com/same']);
    expect(out).toHaveLength(1);
    expect(out![0].id).toBe('Y');
  });

  it('keeps the first id when both duplicates are already persisted', () => {
    // Two persisted rows pointed at one scheduler is a genuine duplicate; one has to go, and the
    // one the practitioner is looking at first is the one that stays.
    const out = rows(['X', 'Y'], ['a', 'b'], ['https://cal.com/same', 'https://cal.com/same']);
    expect(out).toEqual([{ id: 'X', label: 'a', url: 'https://cal.com/same' }]);
  });

  it('keeps the label of the surviving row, not the duplicate', () => {
    const out = rows(['X', ''], ['keep me', 'drop me'], ['https://cal.com/s', 'https://cal.com/s']);
    expect(out![0].label).toBe('keep me');
  });

  it('handles a shorter bookingId array without corrupting alignment', () => {
    // Degradation, not corruption: a missing id reads as new and creates a row.
    const out = rows([], ['a', 'b'], ['https://cal.com/a', 'https://cal.com/b']);
    expect(out).toEqual([
      { id: null, label: 'a', url: 'https://cal.com/a' },
      { id: null, label: 'b', url: 'https://cal.com/b' },
    ]);
  });

  it('returns an empty list when every row is blank, which clears all links', () => {
    expect(rows(['X', 'Y'], ['', ''], ['', ''])).toEqual([]);
  });
});
