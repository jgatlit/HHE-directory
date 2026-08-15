import { describe, it, expect } from 'vitest';
import { detectProvider, extractUrlFromEmbed } from '@/lib/booking-providers';

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

  // The reference practitioner is on Acuity, and `as.me` is the domain its own share dialog
  // hands out. It was missing from the save-time allowlist entirely.
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
