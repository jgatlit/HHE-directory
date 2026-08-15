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
