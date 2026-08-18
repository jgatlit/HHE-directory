import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Sessions are effectively non-expiring (operator direction: magic-link is the only way back in,
 * so every expiry costs a non-technical practitioner an email round trip). Three properties make
 * that safe, and they are only safe TOGETHER:
 *
 *   1. the role is re-read per request, never cached for the token's life
 *   2. a deleted user's session ENDS, rather than merely dropping to least privilege
 *   3. a bumped `sessionVersion` kills every token issued before it
 *
 * Without (2) and (3) "never expires" would mean a leaked token is valid forever, because the JWT
 * strategy writes no `Session` rows and there is nothing to delete server-side.
 */

const mocks = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: mocks.findUnique } } }));

import { sessionStateFor } from '@/lib/session-role';

const user = (role = 'PRACTITIONER', sessionVersion = 0) => ({ role, sessionVersion });

beforeEach(() => mocks.findUnique.mockReset());

describe('role freshness — a session that stays open must not carry a stale permission', () => {
  it('returns the CURRENT role, not the one the token was minted with', async () => {
    mocks.findUnique.mockResolvedValue(user('ADMIN'));
    await expect(sessionStateFor('usr_1', 0, false)).resolves.toEqual({ valid: true, role: 'ADMIN', version: 0 });
  });

  it('DEMOTION lands on the next request', async () => {
    mocks.findUnique.mockResolvedValueOnce(user('ADMIN')).mockResolvedValueOnce(user('PRACTITIONER'));
    await expect(sessionStateFor('usr_1', 0, false)).resolves.toMatchObject({ role: 'ADMIN' });
    await expect(sessionStateFor('usr_1', 0, false)).resolves.toMatchObject({ role: 'PRACTITIONER' });
  });

  it('a demoted admin STAYS SIGNED IN — losing admin is not being thrown out', async () => {
    mocks.findUnique.mockResolvedValue(user('PRACTITIONER'));
    await expect(sessionStateFor('usr_1', 0, false)).resolves.toMatchObject({ valid: true });
  });

  it('PROMOTION lands on the next request too — no sign-out required', async () => {
    mocks.findUnique.mockResolvedValue(user('ADMIN'));
    await expect(sessionStateFor('usr_sarah', 0, false)).resolves.toMatchObject({ valid: true, role: 'ADMIN' });
  });
});

describe('the session actually ENDS when it should', () => {
  it('a DELETED user is signed out, not downgraded', async () => {
    mocks.findUnique.mockResolvedValue(null);
    await expect(sessionStateFor('usr_gone', 0, false)).resolves.toEqual({ valid: false, reason: 'user-deleted' });
  });

  it('a REVOKED token is rejected — this is "sign out everywhere"', async () => {
    // Token minted at version 0; the user has since been bumped to 1.
    mocks.findUnique.mockResolvedValue(user('ADMIN', 1));
    await expect(sessionStateFor('usr_1', 0, false)).resolves.toEqual({ valid: false, reason: 'revoked' });
  });

  it('a token at the CURRENT version keeps working — revocation is targeted, not a blanket logout', async () => {
    mocks.findUnique.mockResolvedValue(user('ADMIN', 1));
    await expect(sessionStateFor('usr_1', 1, false)).resolves.toMatchObject({ valid: true, version: 1 });
  });

  it('no user id → invalid, and no pointless query', async () => {
    await expect(sessionStateFor(undefined, 0, false)).resolves.toMatchObject({ valid: false });
    await expect(sessionStateFor('', 0, false)).resolves.toMatchObject({ valid: false });
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });
});

describe('the deploy does not sign everybody out', () => {
  it('a legacy token with no version is accepted once and stamped', async () => {
    // Tokens issued before the column existed carry no `sv`. Rejecting them would log out every
    // current user on deploy — precisely the friction this whole change removes. Not a bypass:
    // tokens are signed with AUTH_SECRET, so no attacker can mint one lacking a version.
    mocks.findUnique.mockResolvedValue(user('ADMIN', 3));
    await expect(sessionStateFor('usr_1', undefined, false)).resolves.toEqual({ valid: true, role: 'ADMIN', version: 3 });
  });

  it('a legacy token still dies once its user is bumped again', async () => {
    // Accepted at v3 and stamped; a later bump to v4 invalidates it like any other.
    mocks.findUnique.mockResolvedValue(user('ADMIN', 4));
    await expect(sessionStateFor('usr_1', 3, false)).resolves.toMatchObject({ valid: false, reason: 'revoked' });
  });

  it('the sign-in call is accepted whatever the token carries', async () => {
    mocks.findUnique.mockResolvedValue(user('ADMIN', 7));
    await expect(sessionStateFor('usr_1', 0, true)).resolves.toMatchObject({ valid: true, version: 7 });
  });
});

describe('the wiring that makes the above reach production', () => {
  const read = (...seg: string[]) => readFileSync(join(__dirname, '..', 'src', ...seg), 'utf8');

  it('the jwt callback returns null on an invalid session — the only way to end one', () => {
    // Anything short of returning null leaves the holder signed in. There are no Session rows to
    // delete, so this single line IS the revocation mechanism.
    const src = read('auth.ts');
    expect(src).toMatch(/if \(!state\.valid\) return null;/);
  });

  it('the callback re-reads per request, not only at sign-in', () => {
    const src = read('auth.ts');
    expect(src).toMatch(/sessionStateFor\(user\?\.id \?\? token\.sub, token\.sv, Boolean\(user\)\)/);
    expect(
      /async jwt\(\{ token, user \}\) \{\s*if \(user\)/.test(src),
      'the jwt callback is gated on `if (user)` again — role and revocation both stop being checked',
    ).toBe(false);
  });

  it('the token carries the version forward', () => {
    expect(read('auth.ts')).toMatch(/token\.sv = state\.version/);
  });

  it('sessions do not practically expire', () => {
    const m = read('auth.config.ts').match(/maxAge:\s*([0-9*\s]+),/);
    expect(m, 'no session maxAge — NextAuth would fall back to its 30-day default').toBeTruthy();
    // eslint-disable-next-line no-eval
    expect(eval(m![1]!) as number).toBeGreaterThan(60 * 60 * 24 * 365);
  });
});
