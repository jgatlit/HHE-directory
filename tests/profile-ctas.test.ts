import { describe, it, expect } from 'vitest';
import {
  offeringsForLink,
  resolveHeroLink,
  ctaLabelFor,
  linkDisplayLabel,
  bookingLinkTarget,
  offeringTarget,
  chooserOptionTarget,
  type CtaOffering,
  type CtaBookingLink,
  linkPriceHint,
  offeringsSurfacedByLinks,
} from '@/lib/profile-ctas';

const link = (id: string, o: Partial<CtaBookingLink> = {}): CtaBookingLink => ({
  id,
  label: null,
  url: `https://cal.com/${id}`,
  ctaLabel: null,
  ...o,
});
const off = (id: string, o: Partial<CtaOffering> = {}): CtaOffering => ({
  id,
  title: `Offering ${id}`,
  priceUsdCents: 5000,
  duration: null,
  isConsult: false,
  bookingLinkId: null,
  listingVisibility: 'LISTED',
  ...o,
});

describe('offeringsForLink — chooser membership ignores visibility', () => {
  // THE property that makes an unlisted free consult reachable at all. §4: the chooser lists all
  // Offerings pointing at the link REGARDLESS of listingVisibility — it is reachable there and
  // nowhere else.
  it('includes LINK_ONLY offerings', () => {
    const offs = [
      off('a', { bookingLinkId: 'L1' }),
      off('free', { bookingLinkId: 'L1', listingVisibility: 'LINK_ONLY', priceUsdCents: 0, isConsult: true }),
      off('other', { bookingLinkId: 'L2' }),
    ];
    expect(offeringsForLink(offs, 'L1').map((o) => o.id)).toEqual(['a', 'free']);
  });

  it('excludes offerings attached to no link', () => {
    expect(offeringsForLink([off('x')], 'L1')).toEqual([]);
  });

  it('preserves the practitioner\'s order — a free consult must NOT be hoisted first', () => {
    const offs = [
      off('paid', { bookingLinkId: 'L1' }),
      off('free', { bookingLinkId: 'L1', priceUsdCents: 0, isConsult: true }),
    ];
    expect(offeringsForLink(offs, 'L1').map((o) => o.id)).toEqual(['paid', 'free']);
  });
});

describe('resolveHeroLink — §14.3 hero suppression', () => {
  it('a designated primary always wins', () => {
    const links = [link('L1'), link('L2')];
    expect(resolveHeroLink(links, 'L2')?.id).toBe('L2');
  });

  it('promotes a SINGLE link when none is designated — no ambiguity to misrepresent', () => {
    expect(resolveHeroLink([link('L1')], null)?.id).toBe('L1');
  });

  // The rule this exists for: with purpose-built links and no designation, a hero pointing at one
  // arbitrary calendar would misrepresent the practice, so the cards lead instead.
  it('SUPPRESSES the hero with several links and none designated', () => {
    expect(resolveHeroLink([link('L1'), link('L2')], null)).toBeNull();
  });

  it('suppresses when the designated id no longer resolves, rather than falling back arbitrarily', () => {
    expect(resolveHeroLink([link('L1'), link('L2')], 'deleted')).toBeNull();
  });

  it('returns null when there are no links at all', () => {
    expect(resolveHeroLink([], 'L1')).toBeNull();
  });
});

describe('ctaLabelFor — §4 label defaulting', () => {
  it('defaults to the free-consult wording when a zero-price offering is attached', () => {
    // When that consult is LINK_ONLY this button is the ONLY signal it exists.
    expect(ctaLabelFor(link('L1'), [off('f', { priceUsdCents: 0, isConsult: true })])).toBe(
      'Book a free consultation',
    );
  });

  it('defaults to "Book now" otherwise', () => {
    expect(ctaLabelFor(link('L1'), [off('a')])).toBe('Book now');
    expect(ctaLabelFor(link('L1'), [])).toBe('Book now');
  });

  it('a practitioner override always wins', () => {
    expect(
      ctaLabelFor(link('L1', { ctaLabel: 'Start here' }), [off('f', { priceUsdCents: 0 })]),
    ).toBe('Start here');
  });

  it('ignores a whitespace-only override rather than rendering a blank button', () => {
    expect(ctaLabelFor(link('L1', { ctaLabel: '   ' }), [off('a')])).toBe('Book now');
  });
});

describe('linkDisplayLabel', () => {
  it('borrows the title when exactly ONE offering is linked, so the two read as one thing', () => {
    expect(linkDisplayLabel(link('L1'), [off('a', { title: 'Root Cause Release' })])).toBe(
      'Root Cause Release',
    );
  });

  it('falls back when there is no single title to borrow', () => {
    expect(linkDisplayLabel(link('L1'), [off('a'), off('b')])).toBe('Book a session');
  });

  it('the practitioner\'s own label wins', () => {
    expect(linkDisplayLabel(link('L1', { label: 'My calendar' }), [off('a')])).toBe('My calendar');
  });
});

describe('bookingLinkTarget — §4 entry-point routing', () => {
  it('ZERO linked offerings still enters the flow — a supported entry point, not unconfigured', () => {
    const t = bookingLinkTarget('sarah', link('L1'), []);
    expect(t.kind).toBe('flow');
    if (t.kind === 'flow') {
      expect(t.href).toContain('/practitioners/sarah/book?link=L1');
      expect(t.href).not.toContain('offering=');
    }
  });

  it('ONE linked offering goes straight in carrying it — the fast path survives', () => {
    const t = bookingLinkTarget('sarah', link('L1'), [off('a', { bookingLinkId: 'L1' })]);
    expect(t.kind).toBe('flow');
    if (t.kind === 'flow') expect(t.href).toContain('offering=a');
  });

  it('TWO OR MORE opens the chooser instead of picking one arbitrarily', () => {
    const t = bookingLinkTarget('sarah', link('L1'), [
      off('a', { bookingLinkId: 'L1' }),
      off('b', { bookingLinkId: 'L1' }),
    ]);
    expect(t.kind).toBe('chooser');
  });
});

describe('offeringTarget — a decided buyer is never re-presented a menu', () => {
  it('carries the offering, and the link when one resolves', () => {
    const href = offeringTarget('sarah', off('a', { bookingLinkId: 'L1' }));
    expect(href).toContain('offering=a');
    expect(href).toContain('link=L1');
  });

  it('omits the link when the offering has none — no calendar step exists', () => {
    const href = offeringTarget('sarah', off('a'));
    expect(href).toContain('offering=a');
    expect(href).not.toContain('link=');
  });

  it('encodes the slug rather than interpolating it raw', () => {
    expect(offeringTarget('a/b', off('x'))).toContain('/practitioners/a%2Fb/book');
  });
});

describe('chooserOptionTarget — the two chooser paths share one construction', () => {
  it('carries both link and offering', () => {
    const href = chooserOptionTarget('sarah', 'L1', 'off1');
    expect(href).toBe('/practitioners/sarah/book?link=L1&offering=off1');
  });

  it('encodes each component', () => {
    expect(chooserOptionTarget('a/b', 'L 1', 'o&1')).toContain('/practitioners/a%2Fb/book');
    expect(chooserOptionTarget('s', 'L 1', 'o&1')).toContain('link=L+1');
    expect(chooserOptionTarget('s', 'L1', 'o&1')).toContain('offering=o%261');
  });
});

describe('linkPriceHint — booking links are no longer barren (§4, 08-26 call)', () => {
  it('returns the exact price and duration when one offering is linked', () => {
    const hint = linkPriceHint([off('a', { priceUsdCents: 12500, duration: 60 })]);
    expect(hint).toEqual({ minCents: 12500, maxCents: 12500, duration: 60 });
  });

  it('returns a RANGE when several are linked, never one arbitrary price', () => {
    const hint = linkPriceHint([
      off('a', { priceUsdCents: 12500, duration: 60 }),
      off('b', { priceUsdCents: 4900, duration: 30 }),
    ]);
    expect(hint?.minCents).toBe(4900);
    expect(hint?.maxCents).toBe(12500);
    // Durations disagree, so naming one would misdescribe the other.
    expect(hint?.duration).toBeNull();
  });

  it('keeps the duration when several linked offerings agree on it', () => {
    const hint = linkPriceHint([
      off('a', { priceUsdCents: 12500, duration: 60 }),
      off('b', { priceUsdCents: 4900, duration: 60 }),
    ]);
    expect(hint?.duration).toBe(60);
  });

  it('returns NULL for a link with no offerings rather than inventing "Free"', () => {
    // A link with nothing pointing at it has no price. Rendering "Free" would claim something
    // the practitioner never said — on the surface a buyer acts from.
    expect(linkPriceHint([])).toBeNull();
  });

  it('reports a zero-price offering as an honest 0, not as absent', () => {
    const hint = linkPriceHint([off('free', { priceUsdCents: 0, duration: 20 })]);
    expect(hint).toEqual({ minCents: 0, maxCents: 0, duration: 20 });
  });

  it('ignores a zero or null duration instead of rendering "0 min"', () => {
    expect(linkPriceHint([off('a', { duration: 0 })])?.duration).toBeNull();
    expect(linkPriceHint([off('a', { duration: null })])?.duration).toBeNull();
  });
});

describe('free consult — BOTH configurations are valid (operator ruling 2026-08-27)', () => {
  // The spec (§3, D2) and tsk_17bfb456 appeared to contradict each other on whether a free
  // consult "is" an Offering. The ruling: it depends on how the practitioner configured it, and
  // BOTH shapes must work. Booking Links and Offerings are distinct entities; a Booking Link may
  // link to zero, one or many Offerings.

  it('SHAPE A (typical) — a bare Booking Link with NO Offerings is a working free consult', () => {
    const l = link('consult');
    // No Whop item, no price tag, nothing to charge for.
    const target = bookingLinkTarget('sarah', l, []);
    expect(target).toEqual({
      kind: 'flow',
      href: '/practitioners/sarah/book?link=consult',
    });
    // Straight into the flow — NOT a chooser, and carrying no offering id.
    if (target.kind !== 'flow') throw new Error('narrow');
    expect(target.href).not.toContain('offering=');

    // It is primary-CTA-able: a single link is promoted to the hero with none designated.
    expect(resolveHeroLink([l], null)).toEqual(l);

    // And there is genuinely no price to state, so none is invented.
    expect(linkPriceHint([])).toBeNull();
  });

  it('SHAPE B — a zero-price Offering on a link is also a free consult, and labels itself', () => {
    const l = link('catchall');
    const free = off('free', { priceUsdCents: 0, isConsult: true, bookingLinkId: 'catchall' });
    // This is the shape §3 exists for: a free consult COEXISTING with paid services on one link,
    // which shape A cannot express.
    expect(ctaLabelFor(l, [free])).toBe('Book a free consultation');
    expect(linkPriceHint([free])).toEqual({ minCents: 0, maxCents: 0, duration: null });
  });

  it('SHAPE B stays reachable when unlisted, which is the only place it appears', () => {
    const l = link('catchall');
    const free = off('free', {
      priceUsdCents: 0,
      isConsult: true,
      bookingLinkId: 'catchall',
      listingVisibility: 'LINK_ONLY',
    });
    const paid = off('deep', { priceUsdCents: 19900, bookingLinkId: 'catchall' });
    // Chooser membership ignores listingVisibility — that is what makes an unlisted free consult
    // reachable there and nowhere else (§4, D3).
    expect(offeringsForLink([free, paid], 'catchall')).toHaveLength(2);
    expect(bookingLinkTarget('sarah', l, [free, paid])).toEqual({ kind: 'chooser' });
  });
});

describe('offeringsSurfacedByLinks — the rail must not repeat the booking links (§14.1)', () => {
  it('PURPOSE-BUILT: one link per offering surfaces every one of them', () => {
    // Sarah Schindler's live shape, and the one that actually broke: 4 links, 3 carrying a
    // specific offering. The link rows already show title + price + duration, so the rail
    // would have printed the identical three entries directly beneath them.
    const links = [link('free'), link('l1'), link('l2'), link('l3')];
    const offs = [
      off('o1', { bookingLinkId: 'l1' }),
      off('o2', { bookingLinkId: 'l2' }),
      off('o3', { bookingLinkId: 'l3' }),
    ];
    expect(offeringsSurfacedByLinks(links, offs)).toEqual(new Set(['o1', 'o2', 'o3']));
  });

  it('CATCH-ALL: one link with many offerings surfaces NONE of them', () => {
    // The link can only show a price RANGE and names no offering, so the rail is the only place
    // they appear and must not be suppressed.
    const links = [link('catchall')];
    const offs = [
      off('o1', { bookingLinkId: 'catchall' }),
      off('o2', { bookingLinkId: 'catchall' }),
    ];
    expect(offeringsSurfacedByLinks(links, offs).size).toBe(0);
  });

  it('a bare free-consult link (zero offerings) surfaces nothing', () => {
    expect(offeringsSurfacedByLinks([link('consult')], []).size).toBe(0);
  });

  it('leaves an unlinked offering in the rail — nothing else shows it', () => {
    const links = [link('l1')];
    const offs = [off('o1', { bookingLinkId: 'l1' }), off('standalone', { bookingLinkId: null })];
    const surfaced = offeringsSurfacedByLinks(links, offs);
    expect(surfaced.has('o1')).toBe(true);
    expect(surfaced.has('standalone')).toBe(false);
  });
});
