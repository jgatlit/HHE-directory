'use client';

import { useEffect, useState } from 'react';

type Props = {
  defaultName?: string | null;
  defaultState?: string | null;
};

type Suggestion = { name: string; state: string };

/**
 * City entry: free to type, suggestions from the US Census Gazetteer.
 *
 * The control this replaced was a <select> over 14 hand-seeded rows, so any practitioner outside
 * those 14 could not enter their own city. Sarah Schindler, onboarding live on 2026-08-11: "is
 * there's not a way to, like, type in a city?"
 *
 * That was not a form annoyance. A missing city fails isProfileComplete(), which fails
 * isListed(), so the practitioner is invisible in the directory with no error shown anywhere —
 * and it had already caught the one practitioner it could least afford to.
 *
 * Free text alone would trade that for a facet problem: cityName/cityState are faceted in
 * Typesense, so "Chicago" / "chicago" / "Chgo" would each become their own filter. Suggestions
 * from a real place catalog keep the field free to type while the taxonomy still converges, and
 * the same catalog gives the server real coordinates for whatever gets created.
 *
 * Suggestions are fetched rather than bundled: the catalog is ~1.2MB and has no business being
 * shipped to a browser. A <datalist> renders them, so the input degrades to plain free text if
 * the request fails or JS is off — which is the correct failure mode for a field that gates
 * whether someone appears at all.
 */
export function CityField({ defaultName, defaultState }: Props) {
  const [query, setQuery] = useState(defaultName ?? '');
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
    <div className="grid grid-cols-[1fr_7rem] gap-2">
      <div className="space-y-1">
        <input
          name="cityName"
          list="nhp-city-names"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Chicago"
          autoComplete="off"
          className="h-10 w-full rounded-md border bg-card px-3 text-sm outline-none ring-ring/30 focus-visible:ring-2"
        />
        <p className="text-[11px] text-muted-foreground">
          Start typing any US city. Work remotely? Use{' '}
          <span className="font-medium">Virtual Practice</span> /{' '}
          <span className="font-medium">Online</span>. Needed to appear in directory search.
        </p>
      </div>
      <input
        name="cityState"
        defaultValue={defaultState ?? ''}
        placeholder="IL"
        aria-label="State"
        autoComplete="off"
        maxLength={10}
        className="h-10 w-full rounded-md border bg-card px-3 text-sm outline-none ring-ring/30 focus-visible:ring-2"
      />

      {/* Suggestion values carry the state so picking one is unambiguous — there are nine
          Atlantas. The server splits the trailing ", ST" back off on save. */}
      <datalist id="nhp-city-names">
        {suggestions.map((s) => (
          <option key={`${s.name}|${s.state}`} value={`${s.name}, ${s.state}`} />
        ))}
      </datalist>
    </div>
  );
}
