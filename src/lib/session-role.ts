import type { Role } from '@prisma/client';
import { prisma } from './prisma';

/**
 * The role a session should carry RIGHT NOW, read from the database.
 *
 * Extracted from the `jwt` callback rather than written inline there for two reasons. The
 * callback lives inside the `NextAuth({...})` call in src/auth.ts, so it is neither exported nor
 * importable — a test could only mirror it, and a mirror asserts nothing about what ships. And
 * this is the function that decides whether a demoted admin still holds admin, which is exactly
 * the kind of decision that should be directly testable.
 *
 * ## Why this exists at all
 *
 * The session used to cache `role` at sign-in and never re-read it. That coupled two unrelated
 * questions — *are you signed in?* and *what may you do?* — to one token lifetime, so the only
 * lever for bounding a stale permission was to expire everyone's session. With magic-link as the
 * sole authentication, every expiry costs the practitioner an email round trip.
 *
 * Reading the role per request decouples them: sessions can now last effectively forever
 * (operator direction — simplicity and low friction for a non-technical cohort) while a role
 * change takes effect on the NEXT REQUEST rather than in up to 30 days.
 *
 * Cost is one indexed primary-key lookup per `auth()` call. At this scale that is noise; if
 * request volume ever makes it matter, cache it behind a timestamp claim — do NOT solve it by
 * going back to caching the role for the life of the token.
 */
export async function currentRoleFor(userId: string | undefined | null): Promise<Role> {
  if (!userId) return 'CLIENT';

  const dbUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });

  // A token whose user row is gone gets the least privilege, never the benefit of the doubt.
  // This is the deleted-account path, and it must not read as "keep whatever you had".
  return dbUser?.role ?? 'CLIENT';
}
