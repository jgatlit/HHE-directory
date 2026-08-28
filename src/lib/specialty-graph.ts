/**
 * Co-occurrence between specialties: two are linked when the same practitioner holds both,
 * weighted by how many practitioners do.
 *
 * This is what makes the specialty field a real graph rather than a decoration. The WebGL
 * constellation it replaces encoded practitioner count as sphere radius and nothing else — and
 * with 21 of 29 specialties held by exactly one practitioner, that encoding carried no
 * information for most of the field. Adjacency, unlike size, has something true to show here:
 * practitioners hold 3.9 specialties on average, so the directory genuinely has clusters.
 *
 * ⚠️ CALLERS MUST PASS THE SAME FILTERED SET THE INDEX RENDERS. `getDirectory()` admits only
 * `status === 'ACTIVE'` specialties, so PROPOSED/MERGED slugs must be stripped BEFORE this runs,
 * or it emits edges pointing at nodes that were never rendered.
 */

export type SpecialtyLink = {
  /** Slugs, ordered `a < b` so a pair is emitted once rather than twice. */
  a: string;
  b: string;
  /** Practitioners holding both. */
  weight: number;
};

/** Separator that cannot occur in a slug, so the key round-trips exactly. */
const KEY = ' ';

export function buildSpecialtyLinks(
  perPractitioner: readonly (readonly string[])[],
): SpecialtyLink[] {
  const weights = new Map<string, number>();

  for (const held of perPractitioner) {
    // Deduped and sorted so `a b` is a stable key, and a practitioner listing the same specialty
    // twice cannot inflate a weight.
    const unique = Array.from(new Set(held)).sort();
    for (let i = 0; i < unique.length; i++) {
      for (let j = i + 1; j < unique.length; j++) {
        const key = unique[i] + KEY + unique[j];
        weights.set(key, (weights.get(key) ?? 0) + 1);
      }
    }
  }

  return Array.from(weights.entries())
    .map(([key, weight]) => {
      const [a, b] = key.split(KEY);
      return { a, b, weight };
    })
    // Heaviest first, then alphabetical. A stable order keeps the server and client renders
    // identical, which matters because this array is serialised into the page.
    .sort((x, y) => y.weight - x.weight || x.a.localeCompare(y.a) || x.b.localeCompare(y.b));
}
