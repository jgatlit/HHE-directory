import { describe, it, expect } from 'vitest';
import {
  ATTRIBUTION_WINDOW_DAYS,
  COMMISSION_RATE,
  resolveAttribution,
  signAttribution,
  verifyAttribution,
} from '@/lib/attribution';

const NOW = 1_787_000_000_000;
const SECRET = 'test-secret-not-a-real-one';

function resolve(opts: {
  path?: string;
  query?: string;
  referrer?: string | null;
}) {
  return resolveAttribution({
    pathname: opts.path ?? '/practitioners/sarah-schindler',
    searchParams: new URLSearchParams(opts.query ?? ''),
    referrer: opts.referrer ?? null,
    selfHost: 'naturalhealthpros.com',
    now: NOW,
  });
}

describe('resolveAttribution — who earns the commission (§16)', () => {
  it('a shared profile link opened directly goes to the PRACTITIONER at 0%', () => {
    const a = resolve({ referrer: null });
    expect(a.party).toBe('PRACTITIONER');
    expect(a.source).toBe('DIRECT_PROFILE');
    expect(COMMISSION_RATE[a.party]).toBe(0);
  });

  it('an explicit ?ref= goes to the PRACTITIONER', () => {
    expect(resolve({ query: 'ref=sarah' }).party).toBe('PRACTITIONER');
  });

  it("a profile reached from the practitioner's own site goes to the PRACTITIONER", () => {
    const a = resolve({ referrer: 'https://sarahschindler.com/about' });
    expect(a.party).toBe('PRACTITIONER');
    expect(a.source).toBe('EXTERNAL_REFERRAL');
  });

  it('organic search goes to NHP at 20%', () => {
    const a = resolve({ referrer: 'https://www.google.com/search?q=naturopath' });
    expect(a.party).toBe('NHP');
    expect(a.source).toBe('ORGANIC_SEARCH');
    expect(COMMISSION_RATE[a.party]).toBe(0.2);
  });

  it('a paid campaign goes to NHP even when it lands straight on a profile', () => {
    const a = resolve({ query: 'utm_source=meta&utm_campaign=spring', referrer: null });
    expect(a.party).toBe('NHP');
    expect(a.source).toBe('PAID_CAMPAIGN');
    expect(a.campaign).toEqual({ utm_source: 'meta', utm_campaign: 'spring' });
  });

  it('a click-id with no utm params still counts as paid', () => {
    expect(resolve({ query: 'gclid=abc123' }).party).toBe('NHP');
  });

  it('the directory itself goes to NHP — both landing on it and clicking through from it', () => {
    expect(resolve({ path: '/search', referrer: null }).party).toBe('NHP');
    expect(resolve({ path: '/', referrer: null }).party).toBe('NHP');
    // Clicked a profile FROM our own search page: we produced that visit.
    const viaUs = resolve({ referrer: 'https://naturalhealthpros.com/search?q=herbalist' });
    expect(viaUs.party).toBe('NHP');
    expect(viaUs.source).toBe('DIRECTORY');
  });

  // ── Operator ruling 2026-08-28, replacing the earlier D17 ────────────────────────────────
  // "Practitioner attribution always links DIRECTLY to a practitioner profile. Organic search or
  // links shared by NHP always attribute to NHP." The previous rule order gave `?ref=` absolute
  // precedence on every path, which made a bare `?ref=` an unauthenticated commission waiver.
  describe('operator ruling: organic and NHP-shared links always win', () => {
    it('ORGANIC SEARCH beats ?ref= — it is always NHP', () => {
      const a = resolve({ query: 'ref=sarah', referrer: 'https://www.google.com/search?q=x' });
      expect(a.party).toBe('NHP');
      expect(a.source).toBe('ORGANIC_SEARCH');
    });

    it('a campaign link beats ?ref= — NHP shared it, so it is NHP', () => {
      expect(resolve({ query: 'ref=sarah&utm_source=meta' }).party).toBe('NHP');
    });

    it('?ref= on a NON-profile page is ignored — it is the directory, and ours', () => {
      // THE DEFECT THIS FIXES: anyone could post naturalhealthpros.com/search?ref=1 and zero
      // NHP's commission for every visitor through it, for 60 days, on ANY practitioner.
      expect(resolve({ path: '/search', query: 'ref=1' }).party).toBe('NHP');
      expect(resolve({ path: '/', query: 'ref=1' }).party).toBe('NHP');
      expect(resolve({ path: '/practitioners', query: 'ref=1' }).party).toBe('NHP');
    });

    it('?ref= on the practitioner\'s OWN profile still credits her at 0%', () => {
      const a = resolve({ path: '/practitioners/sarah-schindler', query: 'ref=sarah' });
      expect(a.party).toBe('PRACTITIONER');
      expect(a.source).toBe('REF_PARAM');
    });

    it('records the ref VALUE, so a waived commission names who claimed it', () => {
      expect(resolve({ query: 'ref=sarah-schindler' }).ref).toBe('sarah-schindler');
      expect(resolve({}).ref).toBeNull();
    });

    it('organic Google from ANY ccTLD is NHP, not just .com', () => {
      for (const h of ['google.de','google.ca','google.fr','google.co.uk','google.com.au','google.co.in']) {
        expect(resolve({ referrer: `https://www.${h}/search?q=x` }).party).toBe('NHP');
      }
      // and lookalikes must NOT match
      for (const h of ['evilgoogle.com','google.com.attacker.io','notgoogle.de']) {
        expect(resolve({ referrer: `https://${h}/x` }).party).toBe('PRACTITIONER');
      }
    });

    it('caps landingPath so an oversized cookie is never silently dropped', () => {
      expect(resolve({ path: '/' + 'a'.repeat(3000) }).landingPath.length).toBeLessThanOrEqual(200);
    });
  });

  it('never throws on a malformed Referer — it runs on every request to the site', () => {
    expect(() => resolve({ referrer: 'not-a-url' })).not.toThrow();
    expect(resolve({ referrer: 'not-a-url' }).referrerHost).toBeNull();
  });

  it('records the landing path and first-touch timestamp', () => {
    const a = resolve({ path: '/practitioners/sarah-schindler' });
    expect(a.landingPath).toBe('/practitioners/sarah-schindler');
    expect(a.ts).toBe(NOW);
  });
});

describe('signing — HttpOnly is not enough, this decides who is paid', () => {
  it('round-trips a signed attribution', async () => {
    const original = resolve({ query: 'ref=sarah' });
    const token = await signAttribution(original, SECRET);
    expect(await verifyAttribution(token, SECRET, NOW)).toEqual(original);
  });

  it('REJECTS a payload tampered to flip the party', async () => {
    // The whole reason for signing: HttpOnly stops a script READING the cookie, not a client
    // SENDING a forged one. A visitor who could rewrite this to PRACTITIONER would zero out the
    // commission on their own booking.
    const token = await signAttribution(resolve({ path: '/search' }), SECRET);
    const [payload, sig] = token.split('.');
    const decoded = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as { party: string };
    expect(decoded.party).toBe('NHP');
    decoded.party = 'PRACTITIONER';
    const forged = `${Buffer.from(JSON.stringify(decoded)).toString('base64url')}.${sig}`;
    expect(await verifyAttribution(forged, SECRET, NOW)).toBeNull();
  });

  it('rejects a signature made with a different secret', async () => {
    const token = await signAttribution(resolve({}), 'some-other-secret');
    expect(await verifyAttribution(token, SECRET, NOW)).toBeNull();
  });

  it('rejects garbage and missing values without throwing', async () => {
    expect(await verifyAttribution(undefined, SECRET, NOW)).toBeNull();
    expect(await verifyAttribution('', SECRET, NOW)).toBeNull();
    expect(await verifyAttribution('nodot', SECRET, NOW)).toBeNull();
    expect(await verifyAttribution('a.b', SECRET, NOW)).toBeNull();
  });

  it('expires a first touch older than the window', async () => {
    const token = await signAttribution(resolve({}), SECRET);
    const windowMs = ATTRIBUTION_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    // One day inside the window: still valid.
    expect(await verifyAttribution(token, SECRET, NOW + windowMs - 86_400_000)).not.toBeNull();
    // One second past it: gone.
    expect(await verifyAttribution(token, SECRET, NOW + windowMs + 1000)).toBeNull();
  });
});

describe('first touch wins — the property the whole mechanism rests on', () => {
  // The middleware guard is one line (`if (existing) return res`), and an untested one-line guard
  // is exactly how a mechanism ends up inert while every other test still passes. This asserts
  // the composition that guard performs: a still-valid cookie verifies, so the later visit is
  // never re-resolved and the ORIGINAL landing values survive.
  it('a valid earlier cookie still verifies on a later visit, so it is never re-resolved', async () => {
    const firstTouch = resolve({ query: 'ref=sarah' }); // practitioner-shared link
    const cookie = await signAttribution(firstTouch, SECRET);

    // ...30 days later the same visitor arrives through our own /search page. Re-resolving THAT
    // request would hand the booking to NHP and take 20% off a practitioner-driven lead.
    const thirtyDaysLater = NOW + 30 * 24 * 60 * 60 * 1000;
    const held = await verifyAttribution(cookie, SECRET, thirtyDaysLater);

    expect(held).not.toBeNull();
    expect(held!.party).toBe('PRACTITIONER');
    expect(held!.ts).toBe(NOW);
    expect(held!.landingPath).toBe('/practitioners/sarah-schindler');

    // And for contrast: what the later request WOULD have resolved to on its own.
    const wouldBe = resolveAttribution({
      pathname: '/practitioners/sarah-schindler',
      searchParams: new URLSearchParams(''),
      referrer: 'https://naturalhealthpros.com/search',
      selfHost: 'naturalhealthpros.com',
      now: thirtyDaysLater,
    });
    expect(wouldBe.party).toBe('NHP');
  });
});

describe('commission rates (§17)', () => {
  it('practitioner-driven traffic is never charged', () => {
    // Deliberate: practitioners must not be penalised for sending their own clients through us.
    expect(COMMISSION_RATE.PRACTITIONER).toBe(0);
    expect(COMMISSION_RATE.NHP).toBe(0.2);
  });
});
