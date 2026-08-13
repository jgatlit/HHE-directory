'use client';

import { useEffect, useState } from 'react';

type Props = {
  defaultName?: string | null;
  defaultState?: string | null;
};

type Suggestion = { name: string; state: string };

/**
 * City entry: one field, free to type, suggestions from the US Census Gazetteer.
 *
 * ONE FIELD, NOT TWO. The first revision paired this with a small separate state box, and that
 * shape produced three defects at once, all on the DEFAULT path of someone who types a city and
 * ignores the second box:
 *   - a blank state fell through `stateRaw.toUpperCase() || 'Online'` to the virtual sentinel, so
 *     "Chicago" was stored as being in state "Online";
 *   - findPlace then matched the sentinel on state alone and relabelled the city itself
 *     "Virtual Practice";
 *   - and a STALE prefilled state beat the state embedded in the suggestion just picked, so
 *     choosing "Denver, CO" while the box still read "GA" filed the practitioner under Georgia.
 * A single "Chicago, IL" value has no second source of truth to disagree with.
 *
 * It also fixes the facet problem the catalog exists for: a free-text state box let "IL" / "Ill" /
 * "Illinois" become three City rows and three Typesense facet values for one city.
 *
 * Why a field at all: a missing city fails isProfileComplete(), which fails isListed(), so the
 * practitioner is invisible in the directory. The control this replaced was a <select> over 14
 * hand-seeded rows — Sarah Schindler, onboarding live 2026-08-11: "is there's not a way to, like,
 * type in a city?"
 *
 * Suggestions are fetched rather than bundled (the catalog is ~1.2MB) and rendered in a <datalist>,
 * so the input degrades to plain free text if the request fails or JS is off. The server resolves
 * whatever arrives against the catalog and reports an error rather than silently storing nothing.
 */
export function CityField({ defaultName, defaultState }: Props) {
  const initial = defaultName ? (defaultState ? `${defaultName}, ${defaultState}` : defaultName) : '';
  const [query, setQuery] = useState(initial);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/cities?q=${encodeURIComponent(q)}`, { signal: ctl.signal })
        .then((r) => (r.ok ? r.json() : { places: [] }))
        .then((d: { places?: Suggestion[] }) => setSuggestions(d.places ?? []))
        .catch(() => {
          /* typeahead is an assist, not a requirement — free text still submits */
        });
    }, 180);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [query]);

  return (
    <div className="space-y-1">
      <input
        name="cityName"
        list="nhp-city-names"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Chicago, IL"
        autoComplete="off"
        className="h-10 w-full rounded-md border bg-card px-3 text-sm outline-none ring-ring/30 focus-visible:ring-2"
      />
      <p className="text-[11px] text-muted-foreground">
        Start typing and pick your city from the list. Work remotely? Choose{' '}
        <span className="font-medium">Virtual Practice, Online</span>. Needed to appear in directory
        search.
      </p>

      {/* Values carry the state because there are nine Atlantas; the server splits it back off. */}
      <datalist id="nhp-city-names">
        {suggestions.map((s) => (
          <option key={`${s.name}|${s.state}`} value={`${s.name}, ${s.state}`} />
        ))}
      </datalist>
    </div>
  );
}
