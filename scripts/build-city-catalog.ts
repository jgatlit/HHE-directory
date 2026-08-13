/**
 * Regenerates src/data/us-places.json from the US Census Bureau Gazetteer.
 *
 *   npx tsx scripts/build-city-catalog.ts
 *
 * Run it when the Census publishes a new vintage (roughly annual). The output is committed, so
 * builds and requests never depend on census.gov being reachable.
 *
 * WHY THIS EXISTS
 * The city control was a <select> over 14 hand-seeded rows, which locked every practitioner
 * outside those 14 out of a complete profile — and an incomplete profile is an unlisted one.
 * Free text fixed the lockout but trades it for a facet problem: cityName/cityState are faceted
 * in Typesense, so "Chicago" / "chicago" / "Chgo" would each become their own filter. A catalog
 * of real place names is what lets the field stay free-to-type while still converging.
 *
 * WHY THE CENSUS GAZETTEER
 * Public domain (a US Government work — no licence terms, no attribution requirement, nothing to
 * comply with), authoritative, and complete: 32k incorporated places and CDPs across all 50
 * states, DC, PR and the territories.
 *
 * Decisively, it also carries INTPTLAT/INTPTLONG. That closes a hole opened when free-text city
 * shipped: CITY_COORDS is a hand-maintained map of 14 entries, so any city created by a
 * practitioner had no coordinates and silently dropped out of the haversine "near me" ranking.
 * With the gazetteer, a newly created city gets real coordinates for free. One dataset, both
 * problems.
 *
 * NAME NORMALIZATION
 * The gazetteer's NAME carries its legal-status suffix — "Atlanta city", "Abanda CDP", "Scarsdale
 * village". Practitioners type "Atlanta", so the suffix is stripped for display. Where stripping
 * collides (a "city" and a "CDP" of the same name in one state), the incorporated place wins:
 * it is the one a person means.
 *
 * SIZE
 * ~32k rows as arrays rather than objects, which is what keeps this near 1MB instead of several.
 * It is loaded server-side only and never shipped to the browser — see src/lib/city-catalog.ts.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync, constants as zlibConstants } from 'node:zlib';

const VINTAGE = '2025';
const URL = `https://www2.census.gov/geo/docs/maps-data/data/gazetteer/${VINTAGE}_Gazetteer/${VINTAGE}_Gaz_place_national.zip`;
const OUT = join(process.cwd(), 'src', 'data', 'us-places.json');

// Legal/statistical suffixes the gazetteer appends to NAME. Ordered longest-first so
// "city and borough" is consumed before "borough".
const SUFFIXES = [
  'consolidated government',
  'metropolitan government',
  'unified government',
  'metro government',
  'city and borough',
  'charter township',
  'urban county',
  'municipality',
  'zona urbana',
  'corporation',
  'comunidad',
  'plantation',
  'township',
  'borough',
  'village',
  'town',
  'city',
  'CDP',
];

// Rank by how strongly a name means "a place someone lives in and would name". Incorporated
// places beat census-designated ones on a collision.
const RANK: Record<string, number> = { city: 0, town: 1, village: 2, borough: 3, CDP: 9 };

function splitName(raw: string): { name: string; kind: string } {
  for (const s of SUFFIXES) {
    if (raw.endsWith(` ${s}`)) return { name: raw.slice(0, -(s.length + 1)).trim(), kind: s };
  }
  return { name: raw.trim(), kind: '' };
}

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

async function main() {
  console.log(`fetching ${URL}`);
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`census fetch failed: ${res.status} ${res.statusText}`);
  const zip = Buffer.from(await res.arrayBuffer());

  // The archive holds exactly one member. Rather than add a zip dependency for that, read the
  // local file header for the offset and inflate the member directly. A zip member is RAW
  // deflate (no gzip wrapper), hence inflateRawSync; Z_SYNC_FLUSH lets it stop cleanly at the
  // end of the stream instead of erroring on the central directory that follows it.
  const nameLen = zip.readUInt16LE(26);
  const extraLen = zip.readUInt16LE(28);
  const start = 30 + nameLen + extraLen;
  const text = inflateRawSync(zip.subarray(start), {
    finishFlush: zlibConstants.Z_SYNC_FLUSH,
  }).toString('utf8');

  const lines = text.split('\n');
  const header = lines[0].split('|').map((h) => h.trim());
  const col = (n: string) => header.indexOf(n);
  const [iState, iName, iLat, iLon] = [col('USPS'), col('NAME'), col('INTPTLAT'), col('INTPTLONG')];
  if ([iState, iName, iLat, iLon].some((i) => i < 0)) {
    throw new Error(`unexpected gazetteer header: ${header.join('|')}`);
  }

  // key = `${slug}|${state}` → the best candidate seen so far
  const best = new Map<string, { name: string; state: string; lat: number; lon: number; rank: number }>();

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split('|');
    if (parts.length <= iLon) continue;
    const state = parts[iState].trim();
    const { name, kind } = splitName(parts[iName].trim());
    const lat = Number(parts[iLat]);
    const lon = Number(parts[iLon]);
    if (!name || !state || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const slug = slugify(name);
    if (!slug) continue;
    const key = `${slug}|${state}`;
    const rank = RANK[kind] ?? 5;
    const prev = best.get(key);
    if (!prev || rank < prev.rank) best.set(key, { name, state, lat, lon, rank });
  }

  const places = Array.from(best.values())
    .sort((a, b) => a.name.localeCompare(b.name) || a.state.localeCompare(b.state))
    .map((p) => [p.name, p.state, Number(p.lat.toFixed(4)), Number(p.lon.toFixed(4))]);

  mkdirSync(join(process.cwd(), 'src', 'data'), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ vintage: VINTAGE, source: URL, places }));
  console.log(`wrote ${places.length} places → ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
