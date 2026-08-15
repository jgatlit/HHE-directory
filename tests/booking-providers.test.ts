import { describe, it, expect } from 'vitest';
import { detectProvider, extractUrlFromEmbed, withScheme } from '@/lib/booking-providers';

describe('detectProvider', () => {
  it.each([
    ['https://calendly.com/sarah/intro', 'CALENDLY'],
    ['https://www.calendly.com/sarah/intro', 'CALENDLY'],
    ['https://cal.com/sarah/30min', 'CAL_COM'],
    ['https://app.cal.com/sarah', 'CAL_COM'],
    ['https://savvycal.com/sarah/chat', 'SAVVYCAL'],
    ['https://acme.savvycal.com/chat', 'SAVVYCAL'],
    ['https://app.acuityscheduling.com/schedule/abc123', 'ACUITY'],
    ['https://bookings.acuityscheduling.com/schedule.php?owner=123', 'ACUITY'],
  ])('%s → %s', (url, expected) => {
    expect(detectProvider(url)).toBe(expected);
  });

  // The reference practitioner is on Acuity and `as.me` is what its share dialog hands out.
  // NOTE: an earlier version of this comment claimed those links were rejected on save. They were
  // not — normalizeUrl only rejects a host with no dot at all, so every dotted host has always
  // passed. What matters here is that they DETECT as Acuity rather than falling to the null
  // adapter, which is what selects the right embed and prefill behaviour.
  it('resolves Acuity short links (as.me) — the reference practitioner uses these', () => {
    expect(detectProvider('https://as.me/sarah-schindler')).toBe('ACUITY');
    expect(detectProvider('https://www.as.me/root-cause')).toBe('ACUITY');
  });

  it('returns OTHER for an unknown provider — the null adapter is a valid outcome, not a failure', () => {
    expect(detectProvider('https://bookings.example.com/x')).toBe('OTHER');
  });

  it('returns OTHER rather than throwing on unparseable input', () => {
    expect(detectProvider('not a url')).toBe('OTHER');
    expect(detectProvider('')).toBe('OTHER');
  });

  it('does NOT match a lookalike host that merely contains a provider name', () => {
    // endsWith('.cal.com') must not be satisfied by "evilcal.com" or "notcal.com".
    expect(detectProvider('https://evilcal.com/x')).toBe('OTHER');
    expect(detectProvider('https://calendly.com.attacker.net/x')).toBe('OTHER');
  });
});

describe('extractUrlFromEmbed', () => {
  it('pulls the src out of pasted iframe markup', () => {
    const embed = '<iframe src="https://calendly.com/sarah/intro" width="100%"></iframe>';
    expect(extractUrlFromEmbed(embed)).toBe('https://calendly.com/sarah/intro');
    expect(detectProvider(extractUrlFromEmbed(embed))).toBe('CALENDLY');
  });

  it('handles single quotes and leading whitespace', () => {
    expect(extractUrlFromEmbed("  <iframe  src='https://as.me/x' ></iframe>")).toBe('https://as.me/x');
  });

  it('passes a plain URL through untouched', () => {
    expect(extractUrlFromEmbed(' https://cal.com/x ')).toBe('https://cal.com/x');
  });

  it('returns the input unchanged when it is iframe-like but has no src', () => {
    expect(extractUrlFromEmbed('<iframe></iframe>')).toBe('<iframe></iframe>');
  });
});

describe('extractUrlFromEmbed — hostile and messy markup', () => {
  // A loader <script src> before the frame would otherwise win: the old regex matched the first
  // ` src=` anywhere in the blob, so the practitioner's booking link became a JS asset URL that
  // saved cleanly and turned every "Book" click into a file download.
  it('takes the IFRAME src, not a preceding script src', () => {
    const blob =
      '<script src="https://assets.example.com/widget.js"></script>' +
      '<iframe src="https://calendly.com/sarah/intro"></iframe>';
    expect(extractUrlFromEmbed(blob)).toBe('https://calendly.com/sarah/intro');
    expect(detectProvider(extractUrlFromEmbed(blob))).toBe('CALENDLY');
  });

  // Embed markup is HTML, so `&` arrives entity-encoded. Left undecoded, every query param after
  // the first is silently lost — the buyer lands on a generic page instead of the booked service.
  it('decodes HTML entities so query parameters survive', () => {
    const blob =
      '<iframe src="https://app.acuityscheduling.com/schedule.php?owner=12345&amp;appointmentType=98765"></iframe>';
    const url = new URL(extractUrlFromEmbed(blob));
    expect(url.searchParams.get('owner')).toBe('12345');
    expect(url.searchParams.get('appointmentType')).toBe('98765');
    expect(url.searchParams.get('amp;appointmentType')).toBeNull();
  });
});

describe('withScheme — the client must agree with what the server stores', () => {
  it('prepends https so a scheme-less entry is an ABSOLUTE url, not a relative path', () => {
    // As a bare href this resolved against our own origin and 404'd, telling the practitioner
    // their working scheduler was broken.
    expect(withScheme('as.me/sarah')).toBe('https://as.me/sarah');
    expect(withScheme('calendly.com/x')).toBe('https://calendly.com/x');
  });

  it('leaves an explicit scheme alone and rejects unusable input', () => {
    expect(withScheme('http://cal.com/x')).toBe('http://cal.com/x');
    expect(withScheme('  ')).toBeNull();
    expect(withScheme('javascript:alert(1)')).toBeNull();
  });

  it('detectProvider agrees with the persisted provider for a scheme-less entry', () => {
    // The badge reported "Other" for a link the server stored as CALENDLY.
    expect(detectProvider('calendly.com/sarah/intro')).toBe('CALENDLY');
    expect(detectProvider('as.me/sarah')).toBe('ACUITY');
  });
});
