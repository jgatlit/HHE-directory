/**
 * Builds URLs that the production /search page can actually restore.
 *
 * The production search runs InstantSearch with `routing={true}`, whose default
 * state mapping namespaces every parameter under the index id and keys
 * refinements by their FACET VALUE, not their slug. Verified against
 * naturalhealthpros.com/search on 2026-08-10 by applying a facet and reading
 * the resulting location:
 *
 *   /search?practitioners[refinementList][specialtyNames][0]=Gut%20Health
 *   /search?practitioners[query]=sleep&practitioners[refinementList][cityName][0]=Virtual%20Practice
 *
 * Passing a slug here produces a URL that loads with zero results and no error,
 * which is the worst outcome available — so specialty and city are typed as
 * display names and the call sites read them off the fixture.
 */

const INDEX = 'practitioners';

export const SITE_URL = 'https://naturalhealthpros.com';

export type SearchParams = {
  query?: string;
  /** Specialty display name, e.g. "Gut Health" — not the slug. */
  specialtyName?: string;
  /** City display name, e.g. "Virtual Practice" — not the slug. */
  cityName?: string;
};

export function searchUrl({ query, specialtyName, cityName }: SearchParams = {}): string {
  const params = new URLSearchParams();
  if (query?.trim()) params.set(`${INDEX}[query]`, query.trim());
  if (specialtyName) params.set(`${INDEX}[refinementList][specialtyNames][0]`, specialtyName);
  if (cityName) params.set(`${INDEX}[refinementList][cityName][0]`, cityName);
  const qs = params.toString();
  return qs ? `${SITE_URL}/search?${qs}` : `${SITE_URL}/search`;
}

export function profileUrl(slug: string): string {
  return `${SITE_URL}/practitioners/${slug}`;
}
