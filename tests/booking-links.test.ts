import { describe, it, expect } from 'vitest';
import {
  parseBookingLinkRows,
  duplicateBookingRowKeys,
  MAX_BOOKING_LINKS,
} from '@/lib/booking-links';

/**
 * Guards the zip rules behind in-place booking-link reconciliation.
 *
 * The invariant every test here defends is the same one: a row that already exists in the
 * database must keep its id across a save. `Offering.bookingLinkId` and the practitioner's
 * designated hero CTA both point at that id, so a row silently swapping identity takes those
 * references with it — and it does so without any error, which is why it needs tests rather
 * than review attention.
 *
 * There is deliberately **no dedupe** to guard: a Booking Link is a unique instance, not a unique
 * URL (operator decision 2026-08-13). Collapsing rows that shared a URL used to delete one by id,
 * which is the very identity loss this file exists to prevent. Accidental duplicates are surfaced
 * advisorily by `duplicateBookingRowKeys` instead — see the second describe block.
 */

/**
 * Mirrors production `normalizeBookingUrl` (`actions.ts:94-110`) — deliberately, and it is worth
 * being precise about what that means: production lowercases and strips `www.` only on a THROWAWAY
 * local used for the allowlist check, then returns `url.toString()` unchanged. So it does NOT
 * canonicalise, and `https://www.cal.com/x/` and `https://cal.com/x` do NOT collide.
 *
 * An earlier version of this stub canonicalised host and trailing slash, which made a test pass
 * against a normaliser strictly more aggressive than the real one and assert a dedupe production
 * never performs. A stub that flatters the code under test is worse than no test.
 */
const normalize = (raw: string): string | null => {
  const trimmed = raw.trim();
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const u = new URL(candidate);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (!u.hostname.includes('.')) return null;
    return u.toString();
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
      { id: 'X', label: 'Free intro', url: 'https://cal.com/a', ctaLabel: null },
      { id: null, label: 'Deep dive', url: 'https://cal.com/b', ctaLabel: null },
    ]);
  });

  it('treats an emptied URL as a removed row, dropping its id from the keep set', () => {
    // The id must NOT survive — the reconcile keys deletion off absence from this list, so
    // returning it would resurrect a link the practitioner just cleared.
    const out = rows(['X', 'Y'], ['a', 'b'], ['https://cal.com/a', '   ']);
    expect(out).toEqual([{ id: 'X', label: 'a', url: 'https://cal.com/a', ctaLabel: null }]);
  });

  it('returns null on an unnormalisable URL so the caller can redirect', () => {
    expect(rows([''], ['a'], ['not a url'])).toBeNull();
    expect(rows([''], ['a'], ['javascript:alert(1)'])).toBeNull();
  });

  it('keeps spelling variants as separate links — production does not canonicalise', () => {
    // Documents real behaviour: normalizeBookingUrl returns the URL as given, so www/trailing-slash
    // variants are simply two different strings. If canonicalisation is ever added this should fail.
    const out = rows(['X', 'Y'], ['a', 'b'], ['https://www.cal.com/same/', 'https://cal.com/same']);
    expect(out).toHaveLength(2);
    expect(out!.map((r) => r.id)).toEqual(['X', 'Y']);
  });

  it('APPROVED DESIGN: the same scheduler may appear on several links, each keeping its own id', () => {
    // A Booking Link is a unique INSTANCE, not a unique URL (operator decision 2026-08-13). This is
    // what lets one Acuity calendar back three differently-named buttons, each wired to its own
    // Offering. The previous dedupe collapsed these and DELETED the loser by id, which would have
    // silently unlinked its offerings once the FK lands.
    const out = rows(
      ['X', 'Y', 'Z'],
      ['Free consult', 'Root Cause Release', 'Human Design'],
      ['https://cal.com/same', 'https://cal.com/same', 'https://cal.com/same'],
    );
    expect(out).toHaveLength(3);
    expect(out!.map((r) => r.id)).toEqual(['X', 'Y', 'Z']);
    expect(out!.map((r) => r.label)).toEqual(['Free consult', 'Root Cause Release', 'Human Design']);
  });

  it('preserves a brand-new row alongside an existing one on the same URL', () => {
    // The identity-inversion case that used to require special handling simply cannot arise now:
    // nothing is dropped, so nothing can displace a persisted id.
    const out = rows(['', 'Y'], ['new', 'original'], ['https://cal.com/s', 'https://cal.com/s']);
    expect(out).toEqual([
      { id: null, label: 'new', url: 'https://cal.com/s', ctaLabel: null },
      { id: 'Y', label: 'original', url: 'https://cal.com/s', ctaLabel: null },
    ]);
  });

  it('keeps every row label — none is discarded in favour of another', () => {
    const out = rows(['X', ''], ['first', 'second'], ['https://cal.com/s', 'https://cal.com/s']);
    expect(out!.map((r) => r.label)).toEqual(['first', 'second']);
  });

  it('handles a shorter bookingId array without corrupting alignment', () => {
    // Degradation, not corruption: a missing id reads as new and creates a row.
    const out = rows([], ['a', 'b'], ['https://cal.com/a', 'https://cal.com/b']);
    expect(out).toEqual([
      { id: null, label: 'a', url: 'https://cal.com/a', ctaLabel: null },
      { id: null, label: 'b', url: 'https://cal.com/b', ctaLabel: null },
    ]);
  });

  it('returns an empty list when every row is blank, which clears all links', () => {
    expect(rows(['X', 'Y'], ['', ''], ['', ''])).toEqual([]);
  });

  it('exposes a row cap the caller enforces, so a huge payload is refused not truncated', () => {
    // The cap lives with the parser but is applied by the action, which redirects. Truncating
    // here would silently drop links the practitioner can still see in their own form.
    expect(MAX_BOOKING_LINKS).toBeGreaterThan(0);
    const many = Array.from({ length: MAX_BOOKING_LINKS + 5 }, (_, i) => `https://cal.com/x${i}`);
    // The parser itself does not enforce it — proving the caller must.
    expect(rows(many.map(() => ''), many.map(() => 'l'), many)).toHaveLength(many.length);
  });
});

describe('duplicateBookingRowKeys — the advisory that replaced the dedupe', () => {
  const row = (id: string, label: string, url: string) => ({ id, label, url });

  it('does NOT flag the same scheduler under different names — that is the feature', () => {
    // The whole point of instance-based links. Warning here would train practitioners to ignore it.
    const dupes = duplicateBookingRowKeys([
      row('a', 'Free consult', 'https://cal.com/s'),
      row('b', 'Deep dive', 'https://cal.com/s'),
    ]);
    expect(dupes.size).toBe(0);
  });

  it('flags rows identical on BOTH url and label — the double-paste signature', () => {
    const dupes = duplicateBookingRowKeys([
      row('a', 'Free consult', 'https://cal.com/s'),
      row('b', 'Free consult', 'https://cal.com/s'),
    ]);
    // Both are flagged, not just the second — the practitioner needs to see the pair.
    expect(dupes).toEqual(new Set(['a', 'b']));
  });

  it('ignores case and surrounding whitespace in BOTH url and label', () => {
    // The raw literal is passed through untouched — an earlier version pre-normalised it with
    // .trim().replace(), so the url half of the comparison was never actually exercised and
    // deleting `.trim().toLowerCase()` from row.url left every test green.
    const dupes = duplicateBookingRowKeys([
      row('a', 'Free Consult', 'https://cal.com/s'),
      row('b', '  free consult ', '  https://CAL.com/s  '),
    ]);
    expect(dupes).toEqual(new Set(['a', 'b']));
  });

  it('is case-insensitive on the URL alone, with labels already identical', () => {
    // Isolates the url half so a regression there cannot hide behind the label comparison.
    const dupes = duplicateBookingRowKeys([
      row('a', 'same', 'https://cal.com/s'),
      row('b', 'same', 'HTTPS://CAL.COM/S'),
    ]);
    expect(dupes.size).toBe(2);
  });

  it('ignores blank rows so an empty new row never warns', () => {
    const dupes = duplicateBookingRowKeys([row('a', '', ''), row('b', '', '')]);
    expect(dupes.size).toBe(0);
  });

  it('flags only the duplicated pair, leaving unrelated rows alone', () => {
    const dupes = duplicateBookingRowKeys([
      row('a', 'Intro', 'https://cal.com/x'),
      row('b', 'Intro', 'https://cal.com/x'),
      row('c', 'Other', 'https://cal.com/y'),
    ]);
    expect(dupes).toEqual(new Set(['a', 'b']));
  });
});

describe('parseBookingLinkRows — ctaLabels zip alignment', () => {
  const normalize = (u: string) => u;

  it('zips ctaLabels by the SAME index as ids/labels/urls', () => {
    const out = parseBookingLinkRows(
      {
        ids: ['A', 'B'],
        labels: ['first', 'second'],
        urls: ['https://cal.com/a', 'https://cal.com/b'],
        ctaLabels: ['Book a free consult', 'Book now'],
      },
      normalize,
    );
    expect(out).toEqual([
      { id: 'A', label: 'first', url: 'https://cal.com/a', ctaLabel: 'Book a free consult' },
      { id: 'B', label: 'second', url: 'https://cal.com/b', ctaLabel: 'Book now' },
    ]);
  });

  // A skipped empty-URL row must not shift the ctaLabels, or one link's button text lands on a
  // different link — silently, with the whole suite green. This is why the other arrays are
  // already tested for exactly this.
  it('keeps alignment when an emptied row is skipped', () => {
    const out = parseBookingLinkRows(
      {
        ids: ['A', 'B', 'C'],
        labels: ['first', 'gone', 'third'],
        urls: ['https://cal.com/a', '', 'https://cal.com/c'],
        ctaLabels: ['CTA-A', 'CTA-GONE', 'CTA-C'],
      },
      normalize,
    );
    expect(out!.map((r) => [r.id, r.ctaLabel])).toEqual([
      ['A', 'CTA-A'],
      ['C', 'CTA-C'],
    ]);
  });

  it('treats a missing or blank ctaLabel as null (use the default)', () => {
    const out = parseBookingLinkRows(
      { ids: ['A'], labels: ['x'], urls: ['https://cal.com/a'], ctaLabels: ['   '] },
      normalize,
    );
    expect(out![0]!.ctaLabel).toBeNull();
  });
});
