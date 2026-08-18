import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Sessions are now effectively non-expiring (operator direction: magic-link is the only way back
 * in, so every expiry costs a non-technical practitioner an email round trip). That is ONLY safe
 * because the role is no longer cached in the token — it is re-read per request.
 *
 * These two properties are load-bearing together and meaningless apart. A long session with a
 * cached role is a permanently stale admin; a short session with a live role is friction for no
 * benefit. Both halves are asserted here.
 */

const mocks = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: mocks.findUnique } } }));

import { currentRoleFor } from '@/lib/session-role';

beforeEach(() => mocks.findUnique.mockReset());

describe('currentRoleFor — the role a session carries right now', () => {
  it('returns the CURRENT database role, not whatever the token was minted with', async () => {
    mocks.findUnique.mockResolvedValue({ role: 'ADMIN' });
    await expect(currentRoleFor('usr_1')).resolves.toBe('ADMIN');
    expect(mocks.findUnique).toHaveBeenCalledWith({ where: { id: 'usr_1' }, select: { role: true } });
  });

  it('DEMOTION takes effect immediately — the whole point of the change', async () => {
    // Same user id, role changed underneath. A token minted while they were ADMIN must not keep
    // conferring ADMIN; before this, it did, for up to 30 days.
    mocks.findUnique.mockResolvedValueOnce({ role: 'ADMIN' }).mockResolvedValueOnce({ role: 'PRACTITIONER' });
    await expect(currentRoleFor('usr_1')).resolves.toBe('ADMIN');
    await expect(currentRoleFor('usr_1')).resolves.toBe('PRACTITIONER');
  });

  it('PROMOTION takes effect immediately too — no sign-out required', async () => {
    // This is the friction that surfaced the whole issue: Sarah was made ADMIN in the database
    // and could not use it until she signed out and back in.
    mocks.findUnique.mockResolvedValue({ role: 'ADMIN' });
    await expect(currentRoleFor('usr_sarah')).resolves.toBe('ADMIN');
  });

  it('a DELETED user gets least privilege, never the benefit of the doubt', async () => {
    mocks.findUnique.mockResolvedValue(null);
    await expect(currentRoleFor('usr_gone')).resolves.toBe('CLIENT');
  });

  it('no user id → CLIENT, and no pointless query', async () => {
    await expect(currentRoleFor(undefined)).resolves.toBe('CLIENT');
    await expect(currentRoleFor(null)).resolves.toBe('CLIENT');
    await expect(currentRoleFor('')).resolves.toBe('CLIENT');
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });
});

describe('the two halves that make a long session safe', () => {
  const read = (...seg: string[]) => readFileSync(join(__dirname, '..', 'src', ...seg), 'utf8');

  it('the jwt callback is NOT gated on sign-in only', () => {
    // `if (user)` here is what cached the role for the life of the token. Its return would make
    // the long maxAge below a permanently-stale-admin bug rather than a feature.
    const src = read('auth.ts');
    expect(src).toMatch(/token\.role = await currentRoleFor\(user\?\.id \?\? token\.sub\)/);
    expect(
      /async jwt\(\{ token, user \}\) \{\s*if \(user\)/.test(src),
      'the jwt callback is gated on `if (user)` again — the role is cached for the token lifetime',
    ).toBe(false);
  });

  it('the session lifetime is long, i.e. sessions do not practically expire', () => {
    const src = read('auth.config.ts');
    const m = src.match(/maxAge:\s*([0-9*\s]+),/);
    expect(m, 'no session maxAge is set — NextAuth would fall back to its 30-day default').toBeTruthy();
    // eslint-disable-next-line no-eval
    const seconds = eval(m![1]!) as number;
    expect(seconds, 'maxAge is under a year — that is a re-authentication the cohort cannot absorb')
      .toBeGreaterThan(60 * 60 * 24 * 365);
  });
});
