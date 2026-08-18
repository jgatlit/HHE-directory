import type { Role } from '@prisma/client';
import { prisma } from './prisma';

/**
 * Whether a session is still valid, and what it may do.
 *
 * Extracted from the `jwt` callback rather than written inline there because the callback lives
 * inside the `NextAuth({...})` call in src/auth.ts — neither exported nor importable, so a test
 * could only mirror it. This is the function that decides whether a deleted user is still signed
 * in and whether a demoted admin still holds admin; it should be directly testable.
 *
 * ## The three questions, deliberately separated
 *
 * 1. **Does this account still exist?** No row → the session ends. Deleting a user signs them out.
 * 2. **Has this session been revoked?** The token carries the `sessionVersion` it was minted
 *    with. If the user's current value differs, every token issued before the bump dies. This is
 *    the revocation lever — a suspected stolen token, a lost device, an offboarding.
 * 3. **What may they do NOW?** The role, read fresh, never cached for the life of the token.
 *
 * Only (1) and (2) end a session. (3) does not: a demoted admin is still a practitioner and
 * should keep working as one, not be thrown out mid-edit.
 *
 * ## Why revocation had to exist at all
 *
 * Sessions no longer expire (auth.config.ts, ~13 months — magic-link is the only way back in, so
 * every expiry costs a non-technical practitioner an email round trip). The JWT strategy writes
 * no `Session` rows, so there is nothing to delete. Without a version counter a leaked token
 * would be valid effectively forever, and the 30-day default that used to close that window by
 * attrition is gone.
 */
export type SessionState =
  | { valid: false; reason: 'no-user-id' | 'user-deleted' | 'revoked' }
  | { valid: true; role: Role; version: number };

export async function sessionStateFor(
  userId: string | undefined | null,
  tokenVersion: unknown,
  /** True only on the sign-in call, where the token has not been stamped yet. */
  isSignIn: boolean,
): Promise<SessionState> {
  if (!userId) return { valid: false, reason: 'no-user-id' };

  const dbUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, sessionVersion: true },
  });

  // Deleted account. Least privilege is not enough here — the session itself must end, or a
  // removed person keeps a working login against a user row that no longer exists.
  if (!dbUser) return { valid: false, reason: 'user-deleted' };

  // A token minted before this column existed carries no version. Accept it ONCE and stamp it,
  // rather than signing every current user out on deploy — the friction this whole change exists
  // to remove. It is not a bypass: tokens are signed with AUTH_SECRET, so an attacker cannot mint
  // one without a version, and any legacy token still dies the moment its user's version is
  // bumped. `isSignIn` is accepted for the same reason: a fresh sign-in has nothing stamped yet.
  const unstamped = typeof tokenVersion !== 'number';
  if (!unstamped && !isSignIn && tokenVersion !== dbUser.sessionVersion) {
    return { valid: false, reason: 'revoked' };
  }

  return { valid: true, role: dbUser.role, version: dbUser.sessionVersion };
}
