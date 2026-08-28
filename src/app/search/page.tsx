import type { Metadata } from 'next';
import { SearchExperience } from '@/components/search/SearchExperience';
import { SiteHeader } from '@/components/site/SiteHeader';
import { siteIdentity } from '@/lib/site-identity';

export const metadata: Metadata = {
  title: 'Search · Natural Health Pros',
  description: 'A curated directory of practitioners trained through Holistic Health Educators.',
};

/**
 * `async` for one reason: the header needs the viewer's identity, and reading it opts this route
 * into dynamic rendering. That is correct and not a regression — /search reads `?…` query state
 * for every refinement, so a prerendered response would have served ONE result set for every
 * query anyway. (Nothing here declares `force-static`; if anything ever does, that is the bug.)
 */
export default async function SearchPage() {
  const { profileHref, signedIn } = await siteIdentity();

  return (
    <>
      <SiteHeader profileHref={profileHref} signedIn={signedIn} />
      <main id="main" className="min-h-screen bg-muted/30 px-4 py-8 sm:py-12">
        <div className="mx-auto max-w-5xl space-y-6">
          <header className="space-y-1">
            <h1 className="font-serif text-2xl font-semibold tracking-tight">
              Find a practitioner
            </h1>
            <p className="text-sm text-muted-foreground">
              HHE-curated. Filter by specialty + city.
            </p>
          </header>
          <SearchExperience />
        </div>
      </main>
    </>
  );
}
