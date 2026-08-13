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
 * response is cacheable per query, so this is not a useful amplification target.
 *
 * Must stay DYNAMIC. An earlier revision set `force-static` reaching for the caching, and the
 * build confirmed the cost: the route rendered as ○ (Static), meaning one prerendered response
 * served for every `?q=` — a typeahead that returns the same suggestions no matter what you type.
 * The Cache-Control header below is what actually buys the caching, and it varies by URL the way
 * a query-driven endpoint needs.
 */
export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  const q = new URL(request.url).searchParams.get('q') ?? '';
  const places = searchPlaces(q.slice(0, 60));
  return NextResponse.json(
    { places: places.map((p) => ({ name: p.name, state: p.state })) },
    { headers: { 'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800' } },
  );
}
