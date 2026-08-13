import { describe, it, expect } from 'vitest';
import { parseBookingLinkRows, MAX_BOOKING_LINKS } from '@/lib/booking-links';

/**
 * Guards the zip/dedupe rules behind in-place booking-link reconciliation.
 *
 * The invariant every test here defends is the same one: a row that already exists in the
 * database must keep its id across a save. `Offering.bookingLinkId` and the practitioner's
 * designated hero CTA both point at that id, so a row silently swapping identity takes those
 * references with it — and it does so without any error, which is why it needs tests rather
 * than review attention.
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

  it('does NOT collapse spelling variants — production does not canonicalise', () => {
    // Documents real behaviour rather than hoped-for behaviour: www/trailing-slash variants of
    // one scheduler ship as two independent links, because normalizeBookingUrl returns the URL
    // as given. If canonicalisation is ever added, this test should fail and be re-decided.
    const out = rows(['X', 'Y'], ['a', 'b'], ['https://www.cal.com/same/', 'https://cal.com/same']);
    expect(out).toHaveLength(2);
    expect(out!.map((r) => r.id)).toEqual(['X', 'Y']);
  });

  it('PINS UNDECIDED BEHAVIOUR: a duplicate group with two persisted ids drops all but the first', () => {
    // ⚠️ NOT a ratified design — this pins current behaviour so that changing it is deliberate.
    // The dropped row is DELETED by the reconcile, and once Offering.bookingLinkId exists with
    // onDelete: Cascade, that silently unlinks every offering pointing at it. The practitioner
    // action that reaches this is ordinary (two labelled buttons repointed at one scheduler).
    // Operator decision pending — error out, drop the dedupe, or migrate the loser's references.
    // Whichever is chosen, this test should be updated to assert it, not left as the answer.
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

  it('exposes a row cap the caller enforces, so a huge payload is refused not truncated', () => {
    // The cap lives with the parser but is applied by the action, which redirects. Truncating
    // here would silently drop links the practitioner can still see in their own form.
    expect(MAX_BOOKING_LINKS).toBeGreaterThan(0);
    const many = Array.from({ length: MAX_BOOKING_LINKS + 5 }, (_, i) => `https://cal.com/x${i}`);
    // The parser itself does not enforce it — proving the caller must.
    expect(rows(many.map(() => ''), many.map(() => 'l'), many)).toHaveLength(many.length);
  });
});
