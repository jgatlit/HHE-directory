import { NextRequest } from 'next/server';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { createAccountLink } from '@/lib/whop';

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
    const callbackUrl = `/api/whop/onboarding/refresh?slug=${encodeURIComponent(slug)}`;
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
 * Whop's account links are short-lived; when one expires mid-KYC-flow, Whop redirects here
 * so we can mint a fresh link and bounce the practitioner straight back into the hosted form
 * — no in-between page, since a stale link left to sit is just a dead end.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const slug = request.nextUrl.searchParams.get('slug');
  if (!slug) redirect('/');

  const practitioner = await authorizeForSlug(slug);

  if (!practitioner.whopCompanyId) {
    redirect(`/practitioners/${slug}/edit?whop=error#payments`);
  }

  let link: { url: string };
  try {
    link = await createAccountLink({
      companyId: practitioner.whopCompanyId,
      slug,
      useCase: 'account_onboarding',
    });
  } catch {
    redirect(`/practitioners/${slug}/edit?whop=error#payments`);
  }

  redirect(link.url);
}
