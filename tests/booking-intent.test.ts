import { describe, it, expect } from 'vitest';
import {
  parseCapture,
  isResumable,
  CAPTURE_LIMITS,
  CAPTURE_DEDUPE_WINDOW_MS,
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
    if (!r.ok) expect(r.error).toMatch(/^USER:/);
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

describe('isResumable — the bound that actually holds today', () => {
  const now = new Date('2026-08-14T12:00:00Z');

  it('resumes a recent PENDING intent instead of creating a duplicate lead', () => {
    expect(isResumable(new Date(now.getTime() - 60_000), now)).toBe(true);
  });

  it('starts fresh once the window has passed', () => {
    expect(isResumable(new Date(now.getTime() - CAPTURE_DEDUPE_WINDOW_MS - 1), now)).toBe(false);
  });

  it('treats the boundary as expired, so the window is a strict upper bound', () => {
    expect(isResumable(new Date(now.getTime() - CAPTURE_DEDUPE_WINDOW_MS), now)).toBe(false);
  });
});
