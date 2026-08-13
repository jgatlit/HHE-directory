import { describe, it, expect } from 'vitest';
import {
  splitCityEntry,
  searchPlaces,
  findPlace,
  findPlacesByName,
  isStateCode,
  VIRTUAL_PLACE,
} from '@/lib/city-catalog';

/**
 * Regression tests for the city-resolution defects found in code review of 1fc73ff.
 *
 * Every case here shipped to production and was wrong. They are written against the real committed
 * catalog rather than fixtures, because two of the three bugs only appeared once real place names
 * were involved ("Santa Fe" ending in a two-letter word, "Virtual Practice, Online" having a
 * multi-letter state).
 */
describe('splitCityEntry', () => {
  it('splits a real state code', () => {
    expect(splitCityEntry('Chicago, IL')).toEqual({ name: 'Chicago', state: 'IL' });
    expect(splitCityEntry('Denver CO')).toEqual({ name: 'Denver', state: 'CO' });
  });

  it('does NOT eat a two-letter word that is not a state', () => {
    // The original `[a-z]{2}$` read "Fe" as a state and searched for a city called "Santa".
    expect(splitCityEntry('Santa Fe')).toEqual({ name: 'Santa Fe', state: null });
  });

  it('splits the virtual sentinel, whose state is a word not a code', () => {
    // The field's own suggestion list emits exactly this string; a two-letter-only pattern
    // failed to split the one value it offers.
    expect(splitCityEntry('Virtual Practice, Online')).toEqual({
      name: VIRTUAL_PLACE.name,
      state: VIRTUAL_PLACE.state,
    });
    expect(splitCityEntry('Online')).toEqual({ name: VIRTUAL_PLACE.name, state: VIRTUAL_PLACE.state });
  });

  it('keeps multi-word names intact', () => {
    expect(splitCityEntry('Winston Salem NC')).toEqual({ name: 'Winston Salem', state: 'NC' });
    expect(splitCityEntry('New York, NY')).toEqual({ name: 'New York', state: 'NY' });
  });
});

describe('findPlace', () => {
  it('never lets the state alone decide the name', () => {
    // This returned VIRTUAL_PLACE, so a practitioner who typed Chicago had their profile,
    // directory card and search document all relabelled "Virtual Practice".
    expect(findPlace('Chicago', 'Online')).toBeNull();
  });

  it('resolves the sentinel by name', () => {
    expect(findPlace('Virtual Practice', 'Online')).toEqual(VIRTUAL_PLACE);
  });

  it('resolves a real place case-insensitively, with coordinates', () => {
    const p = findPlace('chicago', 'il');
    expect(p?.name).toBe('Chicago');
    expect(p?.state).toBe('IL');
    expect(p?.lat).toBeGreaterThan(41);
    expect(p?.lon).toBeLessThan(-87);
  });
});

describe('findPlacesByName', () => {
  it('reports ambiguity rather than picking one', () => {
    // Nine Atlantas — resolving a bare "Atlanta" to the first would file people in the wrong state.
    expect(findPlacesByName('Atlanta').length).toBeGreaterThan(1);
  });

  it('resolves an unambiguous name to exactly one', () => {
    expect(findPlacesByName('Sedona')).toHaveLength(1);
  });
});

describe('searchPlaces', () => {
  it('finds a place whose name ends in a two-letter word', () => {
    const names = searchPlaces('santa fe').map((p) => `${p.name}, ${p.state}`);
    expect(names).toContain('Santa Fe, NM');
  });

  it('ranks the exact match first', () => {
    expect(searchPlaces('chicago')[0]).toMatchObject({ name: 'Chicago', state: 'IL' });
  });

  it('filters by a trailing state code', () => {
    const out = searchPlaces('atlanta ga');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ name: 'Atlanta', state: 'GA' });
  });

  it('surfaces the virtual sentinel for remote practitioners', () => {
    expect(searchPlaces('virtual')).toContainEqual(VIRTUAL_PLACE);
    expect(searchPlaces('online')).toContainEqual(VIRTUAL_PLACE);
  });
});

describe('isStateCode', () => {
  it('accepts real codes and the virtual sentinel, rejects arbitrary letter pairs', () => {
    expect(isStateCode('IL')).toBe(true);
    expect(isStateCode('ga')).toBe(true);
    expect(isStateCode('Online')).toBe(true);
    expect(isStateCode('FE')).toBe(false);
    expect(isStateCode('ZZ')).toBe(false);
  });
});
