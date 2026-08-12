type Props = {
  cities: { name: string; state: string }[];
  defaultName?: string | null;
  defaultState?: string | null;
};

/**
 * Free-text city entry with suggestions, replacing the fixed `<select>`.
 *
 * The select carried 14 rows nationwide, so a practitioner outside those 14 could not enter their
 * own city at all. Sarah Schindler, onboarding live on 2026-08-11: "is there's not a way to, like,
 * type in a city?" — Jonathan: "I need to clean that up where it's not a finite list of cities."
 *
 * This is NOT plain free text, deliberately. `cityName`/`cityState` are faceted in Typesense, so
 * unconstrained input fragments the facet ("Chicago" / "chicago" / "Chicago, IL" become three
 * filters). The datalist steers toward existing rows, and the server normalizes + find-or-creates
 * against City's (slug, state) unique key — so the taxonomy still converges while nobody is
 * locked out. See resolveCityId() in the edit actions.
 *
 * Why the required-ish hint: a missing city fails isProfileComplete(), which fails isListed(),
 * which means the practitioner is invisible in the directory. That trap already caught the one
 * practitioner it could least afford to — she finished onboarding, connected a payment account,
 * and never appeared. Say so here rather than letting the completeness banner carry it alone.
 */
export function CityField({ cities, defaultName, defaultState }: Props) {
  const names = Array.from(new Set(cities.map((c) => c.name))).sort();
  const states = Array.from(new Set(cities.map((c) => c.state))).sort();

  return (
    <div className="grid grid-cols-[1fr_7rem] gap-2">
      <div className="space-y-1">
        <input
          name="cityName"
          list="nhp-city-names"
          defaultValue={defaultName ?? ''}
          placeholder="Chicago"
          autoComplete="address-level2"
          className="h-10 w-full rounded-md border bg-card px-3 text-sm outline-none ring-ring/30 focus-visible:ring-2"
        />
        <p className="text-[11px] text-muted-foreground">
          Type any city. Work remotely? Use <span className="font-medium">Virtual Practice</span> /{' '}
          <span className="font-medium">Online</span>. Needed to appear in directory search.
        </p>
      </div>
      <input
        name="cityState"
        list="nhp-city-states"
        defaultValue={defaultState ?? ''}
        placeholder="IL"
        aria-label="State"
        autoComplete="address-level1"
        className="h-10 w-full rounded-md border bg-card px-3 text-sm outline-none ring-ring/30 focus-visible:ring-2"
      />

      <datalist id="nhp-city-names">
        {names.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      <datalist id="nhp-city-states">
        {states.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </div>
  );
}
