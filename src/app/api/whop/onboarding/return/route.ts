import { NextRequest } from 'next/server';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { getPayoutStatus } from '@/lib/whop';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Auth + ownership gate for this redirect target (not a webhook — a real browser hit).
 * Merges "no such practitioner" and "not your practitioner" into the same `/` outcome so a
 * hit can't distinguish an unknown slug from someone else's — mirrors the shape of
 * authorizeForSlug in practitioners/[slug]/edit/actions.ts (IDOR discipline), scoped to this
 * route's own redirect targets.
 */
async function authorizeForSlug(slug: string) {
  const session = await auth();
  if (!session?.user?.id) {
    const callbackUrl = `/api/whop/onboarding/return?slug=${encodeURIComponent(slug)}`;
    redirect(`/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }
  const practitioner = await prisma.practitioner.findUnique({
    where: { slug },
    select: { id: true, userId: true, whopCompanyId: true },
  });
  const isOwner = practitioner?.userId === session.user.id;
  const isAdmin = session.user.role === 'ADMIN';
  if (!practitioner || (!isOwner && !isAdmin)) {
    redirect('/');
  }
  return practitioner;
}

/**
 * Whop lands the practitioner here the instant they finish the hosted KYC form — that fires
 * BEFORE the provider has actually approved anything. The authoritative signal is the
 * identity_profile.approved webhook, which lands independently (possibly later, possibly
 * never if it's dropped after Whop's retry window). So this route treats itself as
 * best-effort only: it never flips whopPayoutsEnabled, and only opportunistically refreshes
 * whopPayoutStatus from a read so the UI isn't stuck on "not_started" while the webhook is
 * in flight.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const slug = request.nextUrl.searchParams.get('slug');
  if (!slug) redirect('/');

  const practitioner = await authorizeForSlug(slug);

  if (practitioner.whopCompanyId) {
    try {
      const { status } = await getPayoutStatus(practitioner.whopCompanyId);
      if (status !== null) {
        await prisma.practitioner.update({
          where: { id: practitioner.id },
          data: { whopPayoutStatus: status },
        });
      }
    } catch (e) {
      // Deliberately non-fatal. This read is a cosmetic head-start on a status the
      // identity_profile webhook owns anyway, so a transient API failure must not tell a
      // practitioner who just completed KYC successfully that something went wrong.
      console.error('whop onboarding return: status refresh failed (continuing):', e);
    }
  }

  redirect(`/practitioners/${slug}/edit?whop=pending#payments`);
}
