'use server';

import { redirect } from 'next/navigation';
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
  // address to have been claimed by someone else since the request was made.
  const collision = await prisma.user.findFirst({
    where: { email: request.newEmail, id: { not: request.userId } },
    select: { id: true },
  });
  if (collision) {
    await prisma.emailChangeRequest.delete({ where: { token } }).catch(() => undefined);
    redirect(`/auth/confirm-email-change/${token}?error=taken`);
  }

  await prisma.$transaction([
    prisma.user.update({ where: { id: request.userId }, data: { email: request.newEmail } }),
    // Every pending request for this user, not just this token — a re-request before this one
    // was confirmed would otherwise leave an orphaned row pointing at the address just replaced.
    prisma.emailChangeRequest.deleteMany({ where: { userId: request.userId } }),
  ]);

  // The session JWT carries the OLD email in its `email` claim (only `sub`, the user id, is what
  // authorization actually reads) — signing out here is the "force a token refresh" the request
  // action's own comment calls for, rather than leaving a stale address in the token indefinitely.
  // `emailChanged=1` is a flag, not the address — an email address has no business in a URL.
  await signOut({ redirectTo: '/auth/signin?emailChanged=1' });
}
