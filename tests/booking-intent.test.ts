import { describe, it, expect } from 'vitest';
import {
  parseCapture,
  CAPTURE_LIMITS,
  CAPTURE_ERRORS,
  type CaptureInput,
} from '@/lib/booking-intent';

const base: CaptureInput = { name: 'Ada Lovelace', email: 'ada@example.com', phone: '', note: '' };
const p = (o: Partial<CaptureInput> = {}) => parseCapture({ ...base, ...o });

describe('parseCapture — required fields', () => {
  it('accepts name + email alone; phone and note are optional', () => {
    const r = p();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ name: 'Ada Lovelace', email: 'ada@example.com', phone: null, note: null });
  });

  it.each([[''], ['   ']])('rejects a blank name (%s)', (name) => {
    const r = p({ name });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('NAME_REQUIRED');
  });

  it('rejects an unusable email', () => {
    for (const email of ['', 'nope', 'a@b', 'a b@c.com']) {
      expect(p({ email }).ok).toBe(false);
    }
  });

  // An over-strict pattern loses real leads, which is the exact failure this step exists to
  // prevent. These are all deliverable addresses.
  it.each([
    'sarah+booking@wild-rooted.com',
    'first.last@sub.domain.co.uk',
    'x@practitioner.health',
  ])('accepts the real-world address %s', (email) => {
    expect(p({ email }).ok).toBe(true);
  });
});

describe('parseCapture — normalisation', () => {
  it('lowercases email so dedupe cannot be defeated by casing', () => {
    const r = p({ email: '  Ada@Example.COM ' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.email).toBe('ada@example.com');
  });

  it('collapses whitespace in the name', () => {
    const r = p({ name: '  Ada   Lovelace  ' });
    if (r.ok) expect(r.value.name).toBe('Ada Lovelace');
  });

  it('turns blank optionals into null rather than empty strings', () => {
    const r = p({ phone: '   ', note: '  ' });
    if (r.ok) {
      expect(r.value.phone).toBeNull();
      expect(r.value.note).toBeNull();
    }
  });
});

describe('parseCapture — bounds on a PUBLIC unauthenticated write', () => {
  // The rate limiter no-ops in production (no KV provisioned), so these caps are a bound that
  // actually holds rather than one that merely exists.
  it('rejects oversized fields', () => {
    expect(p({ name: 'a'.repeat(CAPTURE_LIMITS.name + 1) }).ok).toBe(false);
    expect(p({ email: `${'a'.repeat(CAPTURE_LIMITS.email)}@x.com` }).ok).toBe(false);
    expect(p({ phone: '1'.repeat(CAPTURE_LIMITS.phone + 1) }).ok).toBe(false);
    expect(p({ note: 'n'.repeat(CAPTURE_LIMITS.note + 1) }).ok).toBe(false);
  });

  it('accepts fields exactly at the limit', () => {
    expect(p({ name: 'a'.repeat(CAPTURE_LIMITS.name) }).ok).toBe(true);
    expect(p({ note: 'n'.repeat(CAPTURE_LIMITS.note) }).ok).toBe(true);
  });
});
describe('error codes, not messages', () => {
  // The page renders these through a fixed lookup. If a code ever escaped that map the alert box
  // would fall silent; if raw text were passed instead, the URL would become a phishing surface
  // on a branded public page carrying the practitioner's real name.
  it('every failure returns a code present in CAPTURE_ERRORS', () => {
    const failures = [
      p({ name: '' }),
      p({ name: 'a'.repeat(CAPTURE_LIMITS.name + 1) }),
      p({ email: 'nope' }),
      p({ phone: '1'.repeat(CAPTURE_LIMITS.phone + 1) }),
      p({ note: 'n'.repeat(CAPTURE_LIMITS.note + 1) }),
    ];
    for (const r of failures) {
      expect(r.ok).toBe(false);
      if (!r.ok) expect(CAPTURE_ERRORS[r.code]).toBeTruthy();
    }
  });

  it('never returns a raw message the caller might echo into the page', () => {
    const r = p({ email: 'nope' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r)).toEqual(['ok', 'code']);
  });
});
