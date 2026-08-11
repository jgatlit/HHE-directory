/*
 * JSON-LD. A directory ranks on structured data, and production emits none.
 *
 * Four graphs, each doing one job:
 *   WebSite + SearchAction — the sitelinks searchbox. The target template uses
 *     the real InstantSearch parameter, so a query arriving from Google lands
 *     on a populated results page rather than an empty one.
 *   Organization — Holistic Health Network, LLC, the entity the client's footer
 *     copy names. NOT MedicalOrganization or MedicalBusiness: the disclaimer
 *     states plainly that this is not a medical provider, and claiming a
 *     medical type in markup would contradict the page's own legal copy.
 *   ItemList of Person — the listed practitioners, each pointing at its profile
 *     page. knowsAbout carries the specialties.
 *   CollectionPage — what the page itself is.
 *
 * Deliberately NOT emitted: FAQPage over the "is / is not" copy. It would parse,
 * but that copy is a scope disclaimer, not questions a searcher asked, and
 * dressing legal text as an FAQ to win a rich result is the kind of thing that
 * earns a manual action.
 */

import type { DirectoryPractitioner } from '@/lib/directory';
import { SITE_URL, profileUrl } from '@/lib/search-url';

const ORG_ID = `${SITE_URL}/#organization`;
const SITE_ID = `${SITE_URL}/#website`;

export function StructuredData({
  practitioners,
  description,
}: {
  practitioners: DirectoryPractitioner[];
  description: string;
}) {
  const graph = [
    {
      '@type': 'Organization',
      '@id': ORG_ID,
      name: 'Holistic Health Network, LLC',
      alternateName: 'Natural Health Pros',
      url: SITE_URL,
      description:
        'Natural Health Pros is the professional online directory for Holistic Health Network, LLC, which works in tandem with Holistic Health Educators, PMA.',
      brand: { '@type': 'Brand', name: 'Natural Health Pros' },
      affiliation: {
        '@type': 'Organization',
        name: 'Holistic Health Educators, PMA',
        url: 'https://www.holistichealtheducators.com/',
      },
    },
    {
      '@type': 'WebSite',
      '@id': SITE_ID,
      url: SITE_URL,
      name: 'Natural Health Pros',
      description,
      publisher: { '@id': ORG_ID },
      inLanguage: 'en-US',
      potentialAction: {
        '@type': 'SearchAction',
        target: {
          '@type': 'EntryPoint',
          urlTemplate: `${SITE_URL}/search?practitioners%5Bquery%5D={search_term_string}`,
        },
        'query-input': 'required name=search_term_string',
      },
    },
    {
      '@type': 'CollectionPage',
      '@id': `${SITE_URL}/#collection`,
      url: SITE_URL,
      name: 'Natural Health Professional Directory',
      description,
      isPartOf: { '@id': SITE_ID },
      about: { '@id': ORG_ID },
      mainEntity: {
        '@type': 'ItemList',
        numberOfItems: practitioners.length,
        itemListElement: practitioners.map((p, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          item: {
            '@type': 'Person',
            name: p.displayName,
            url: profileUrl(p.slug),
            ...(p.headline ? { jobTitle: p.headline } : {}),
            ...(p.photoUrl ? { image: p.photoUrl } : {}),
            ...(p.websiteUrl ? { sameAs: [p.websiteUrl] } : {}),
            knowsAbout: p.specialties.map((s) => s.name),
            memberOf: { '@id': ORG_ID },
          },
        })),
      },
    },
  ];

  return (
    <script
      type="application/ld+json"
      // The payload is built from typed fixture data, never from user input.
      dangerouslySetInnerHTML={{
        __html: JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }),
      }}
    />
  );
}
