import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';

export type SiteIdentity = {
  /** The signed-in practitioner's own profile path, or null. */
  profileHref: string | null;
  /** Whether anyone is signed in at all. */
  signedIn: boolean;
};

/**
 * Header identity, resolved on the server.
 *
 * Extracted from the homepage when `SiteHeader` stopped being homepage-only. Every page that
 * renders the header needs the same two answers, and computing them in three places is how the
 * `signedIn`/`profileHref` distinction below gets quietly collapsed in one of them.
 *
 * ⚠️ `signedIn` is NOT derivable from `profileHref`. `profileHref` is null both for a signed-out
 * visitor and for a signed-in user with no practitioner record — an admin, say — so deriving
 * sign-out from it hides sign-out from exactly the accounts with no other way out of a session.
 * It looks correct today only because all three current admins happen to own a profile.
 *
 * Resolved here rather than inside SiteHeader because that is a client component and the app has
 * no SessionProvider; mounting one around the whole tree to answer two questions is the machinery
 * that decision exists to avoid.
 */
export async function siteIdentity(): Promise<SiteIdentity> {
  const session = await auth();
  if (!session?.user?.id) return { profileHref: null, signedIn: false };

  const ownProfile = await prisma.practitioner.findUnique({
    where: { userId: session.user.id },
    select: { slug: true },
  });

  return {
    profileHref: ownProfile ? `/practitioners/${ownProfile.slug}` : null,
    signedIn: true,
  };
}
