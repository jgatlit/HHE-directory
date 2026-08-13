import catalog from '@/data/us-places.json';

export type Place = { name: string; state: string; lat: number; lon: number };

/**
 * Server-side lookup over the US Census Gazetteer place list (see scripts/build-city-catalog.ts).
 *
 * SERVER ONLY. The catalog is ~1.2MB; importing it from a client component would ship all of it
 * to every visitor to power a typeahead. The API route in src/app/api/cities/route.ts is the
 * browser's door to this, and it returns a handful of rows per keystroke.
 *
 * The point of a catalog at all: cityName/cityState are Typesense facets, so unconstrained free
 * text fragments the facet list ("Chicago" / "chicago" / "Chgo" each become a filter). Steering
 * practitioners onto real place names keeps the field free to type while the taxonomy converges.
 */
const PLACES = (catalog.places as [string, string, number, number][]).map(
  ([name, state, lat, lon]): Place => ({ name, state, lat, lon }),
);

/**
 * A virtual-only practice is not a Census place, but it still has to satisfy the city field —
 * `hasCity` gates isProfileComplete() and therefore isListed(), so a practitioner who works
 * entirely online needs something real to select or they cannot appear in the directory at all.
 * This is the row the seed data already uses, kept first in every result list.
 */
export const VIRTUAL_PLACE: Place = { name: 'Virtual Practice', state: 'Online', lat: 0, lon: 0 };

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Prefix-first search. Ranking is deliberately simple: exact name, then prefix, then substring,
 * and larger states break ties only through the stable source ordering. A practitioner typing
 * their own town finds it in three or four characters, which is the whole requirement — this is
 * not trying to be a geocoder.
 */
export function searchPlaces(query: string, limit = 8): Place[] {
  const q = norm(query);
  if (!q) return [VIRTUAL_PLACE];

  // Accept "chicago, il" / "chicago il" by treating the tail as a state filter.
  const m = q.match(/^(.*?)[,\s]+([a-z]{2})$/);
  const namePart = m ? m[1].trim() : q;
  const statePart = m ? m[2].toUpperCase() : null;

  const exact: Place[] = [];
  const prefix: Place[] = [];
  const contains: Place[] = [];

  for (const p of PLACES) {
    if (statePart && p.state !== statePart) continue;
    const n = norm(p.name);
    if (n === namePart) exact.push(p);
    else if (n.startsWith(namePart)) prefix.push(p);
    else if (namePart.length >= 3 && n.includes(namePart)) contains.push(p);
    if (exact.length + prefix.length >= limit * 3) break;
  }

  const out = [...exact, ...prefix, ...contains].slice(0, limit);
  if (VIRTUAL_PLACE.name.toLowerCase().startsWith(namePart) || namePart === 'online') {
    out.unshift(VIRTUAL_PLACE);
  }
  return out.slice(0, limit);
}

/**
 * Exact resolve for the save path — returns the canonical record so a City row created from a
 * practitioner's typing gets real coordinates. Without this, cities created outside the
 * hand-maintained CITY_COORDS map have no lat/long and silently drop out of the haversine
 * "near me" ranking.
 */
export function findPlace(name: string, state: string): Place | null {
  const n = norm(name);
  const s = state.trim().toUpperCase();
  if (n === norm(VIRTUAL_PLACE.name) || s === 'ONLINE') return VIRTUAL_PLACE;
  return PLACES.find((p) => norm(p.name) === n && p.state === s) ?? null;
}
