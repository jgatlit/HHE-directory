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
 * The set of state codes the catalog actually contains, plus the virtual sentinel.
 *
 * Needed because "is the trailing token a state?" was previously answered by the regex
 * `[a-z]{2}$`, which treats any two-letter final word as a state code — so "santa fe" searched for
 * a city called "Santa" in state "FE" and returned nothing, silently pushing the practitioner onto
 * the raw free-text path. Membership in the real set is the only correct test.
 */
const STATES = new Set<string>([VIRTUAL_PLACE.state.toUpperCase(), ...PLACES.map((p) => p.state)]);

export function isStateCode(s: string): boolean {
  return STATES.has(s.trim().toUpperCase());
}

/**
 * Split a "Chicago, IL" / "Chicago IL" entry into its parts, but only when the trailing token is a
 * REAL state code. "Santa Fe" keeps both words as the name.
 */
export function splitCityEntry(raw: string): { name: string; state: string | null } {
  const value = raw.trim().replace(/\s+/g, ' ');
  // Up to 10 letters, not 2: the virtual sentinel's "state" is the word "Online", and the
  // suggestion list emits it as "Virtual Practice, Online" — a two-letter-only pattern failed to
  // split the one value the field itself offers. isStateCode is what actually decides.
  const m = value.match(/^(.*?)[,\s]+([A-Za-z]{2,10})$/);
  if (m && isStateCode(m[2]) && m[1].trim()) {
    const state = /^online$/i.test(m[2]) ? VIRTUAL_PLACE.state : m[2].toUpperCase();
    return { name: m[1].trim(), state };
  }
  if (/^online$/i.test(value)) return { name: VIRTUAL_PLACE.name, state: VIRTUAL_PLACE.state };
  return { name: value, state: null };
}

/**
 * Prefix-first search. Ranking is deliberately simple: exact name, then prefix, then substring,
 * and larger states break ties only through the stable source ordering. A practitioner typing
 * their own town finds it in three or four characters, which is the whole requirement — this is
 * not trying to be a geocoder.
 */
export function searchPlaces(query: string, limit = 8): Place[] {
  const q = norm(query);
  if (!q) return [VIRTUAL_PLACE];

  // Accept "chicago, il" / "chicago il" as a state filter — but ONLY when the trailing token is
  // a real state code. `[a-z]{2}$` alone ate the "Fe" in "santa fe" and returned nothing.
  const split = splitCityEntry(query);
  const namePart = norm(split.name);
  const statePart = split.state;

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
/**
 * All catalog entries sharing a name, across states. Used when the practitioner typed a bare city
 * with no state: one match resolves cleanly, several means we must NOT guess — picking the first
 * is how somebody ends up filed under the wrong state.
 */
export function findPlacesByName(name: string): Place[] {
  const n = norm(name);
  if (n === norm(VIRTUAL_PLACE.name)) return [VIRTUAL_PLACE];
  return PLACES.filter((p) => norm(p.name) === n);
}

export function findPlace(name: string, state: string): Place | null {
  const n = norm(name);
  const s = state.trim().toUpperCase();
  // The virtual sentinel must match on its NAME. An earlier revision also returned it whenever the
  // state was "Online", which meant findPlace('Chicago','Online') answered "Virtual Practice" — so
  // a practitioner who typed Chicago had their profile, directory card and search document all
  // relabelled Virtual Practice. The state alone never decides the name.
  if (n === norm(VIRTUAL_PLACE.name)) return VIRTUAL_PLACE;
  return PLACES.find((p) => norm(p.name) === n && p.state === s) ?? null;
}
