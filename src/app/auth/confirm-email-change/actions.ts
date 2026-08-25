'use server';

import { redirect } from 'next/navigation';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { signOut } from '@/auth';

/**
 * Complete a practitioner's self-serve email change (see `requestAccountEmailChange` in
 * practitioners/[slug]/edit/actions.ts for the request half of this flow).
 *
 * Deliberately requires an explicit click rather than acting on the page's own GET — a mutating
 * GET would let link-prefetching, an email client's "scan for safety" crawler, or a bookmark
 * silently move the sign-in address with no one at the keyboard. `src/app/auth/invite-accept`
 * follows the same click-to-confirm shape for the same reason.
 */
export async function confirmEmailChange(token: string): Promise<void> {
  const request = await prisma.emailChangeRequest.findUnique({ where: { token } });

  if (!request || request.expiresAt < new Date()) {
    redirect(`/auth/confirm-email-change/${token}?error=expired`);
  }

  // Re-checked here, not just at request time: the interim (up to 24h) leaves room for the
  // address to have been claimed by someone else since the request was made. Case-insensitive
  // for the same reason the request side is — see requestAccountEmailChange.
  const collision = await prisma.user.findFirst({
    where: { email: { equals: request.newEmail, mode: 'insensitive' }, id: { not: request.userId } },
    select: { id: true },
  });
  if (collision) {
    await prisma.emailChangeRequest.delete({ where: { token } }).catch(() => undefined);
    redirect(`/auth/confirm-email-change/${token}?error=taken`);
  }

  try {
    await prisma.$transaction([
      prisma.user.update({
        where: { id: request.userId },
        data: {
          email: request.newEmail,
          // The ONLY real cross-device revocation lever (JWT strategy writes no `Session`
          // rows — see User.sessionVersion's own doc comment and scripts/revoke-sessions.ts).
          // Without this, confirming from a phone would leave a laptop's already-issued JWT
          // carrying the OLD email in its `email` claim indefinitely, since sessions no longer
          // expire. Bumping this invalidates every outstanding token for this user at once,
          // this browser included — the signOut() below is then just a same-device convenience
          // so the confirming browser doesn't have to fail a request first to find out.
          sessionVersion: { increment: 1 },
        },
      }),
      // Every pending request for this user, not just this token — a re-request before this one
      // was confirmed would otherwise leave an orphaned row pointing at the address just replaced.
      // (In practice there is at most one: EmailChangeRequest.userId is itself unique.)
      prisma.emailChangeRequest.deleteMany({ where: { userId: request.userId } }),
    ]);
  } catch (e) {
    // The pre-check above closes the common case, but does not eliminate the race: two
    // DIFFERENT users' requests targeting the same address can both pass their own collision
    // check before either transaction commits. The second to commit hits User.email's unique
    // constraint — redirect to the SAME friendly "taken" state the pre-check already has,
    // rather than an unhandled exception.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      redirect(`/auth/confirm-email-change/${token}?error=taken`);
    }
    throw e;
  }

  // The session JWT carries the OLD email in its `email` claim (only `sub`, the user id, is what
  // authorization actually reads) — signing out here gives the CONFIRMING browser an immediate,
  // clean redirect instead of waiting for its next request to fail sessionVersion's check above.
  // `emailChanged=1` is a flag, not the address — an email address has no business in a URL.
  await signOut({ redirectTo: '/auth/signin?emailChanged=1' });
}
