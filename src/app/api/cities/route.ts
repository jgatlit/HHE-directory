import { NextResponse } from 'next/server';
import { searchPlaces } from '@/lib/city-catalog';

/**
 * City typeahead for the profile form.
 *
 * Exists so the ~1.2MB Census catalog stays on the server: the alternative is importing it into
 * a client component and shipping the whole thing to every visitor to power one input.
 *
 * Public and unauthenticated on purpose — it returns US Census place names, which are public
 * domain reference data and carry nothing about our practitioners. Results are capped and the
 * response is immutable-cacheable per query, so this is not a useful amplification target.
 */
export const dynamic = 'force-static';

export function GET(request: Request) {
  const q = new URL(request.url).searchParams.get('q') ?? '';
  const places = searchPlaces(q.slice(0, 60));
  return NextResponse.json(
    { places: places.map((p) => ({ name: p.name, state: p.state })) },
    { headers: { 'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800' } },
  );
}
