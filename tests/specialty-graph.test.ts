import { describe, it, expect } from 'vitest';
import { buildSpecialtyLinks } from '../src/lib/specialty-graph';

/**
 * The co-occurrence edges behind the specialty field. These are what make it a graph rather than
 * a decoration — the WebGL constellation it replaces encoded only practitioner count as sphere
 * radius, which carried no information for the 21 of 29 specialties held by exactly one person.
 */
describe('buildSpecialtyLinks', () => {
  it('links every pair a practitioner holds together', () => {
    expect(buildSpecialtyLinks([['reiki', 'yoga']])).toEqual([{ a: 'reiki', b: 'yoga', weight: 1 }]);
  });

  it('emits a pair ONCE, ordered, however the practitioner listed it', () => {
    const links = buildSpecialtyLinks([
      ['yoga', 'reiki'],
      ['reiki', 'yoga'],
    ]);
    expect(links).toHaveLength(1);
    expect(links[0]).toEqual({ a: 'reiki', b: 'yoga', weight: 2 });
  });

  it('weights by how many practitioners hold both', () => {
    const links = buildSpecialtyLinks([
      ['a', 'b'],
      ['a', 'b'],
      ['a', 'c'],
    ]);
    expect(links.find((l) => l.b === 'b')?.weight).toBe(2);
    expect(links.find((l) => l.b === 'c')?.weight).toBe(1);
  });

  /**
   * A practitioner listing the same specialty twice must not inflate a weight — otherwise a data
   * glitch would silently thicken a line and misstate how connected two specialties are.
   */
  it('a duplicate within one practitioner cannot inflate a weight', () => {
    const links = buildSpecialtyLinks([['a', 'a', 'b']]);
    expect(links).toEqual([{ a: 'a', b: 'b', weight: 1 }]);
  });

  it('a practitioner holding one specialty produces no edge', () => {
    expect(buildSpecialtyLinks([['solo'], [], ['solo']])).toEqual([]);
  });

  it('n specialties on one practitioner produce n(n-1)/2 edges', () => {
    expect(buildSpecialtyLinks([['a', 'b', 'c', 'd']])).toHaveLength(6);
  });

  /**
   * Order is deterministic because this array is serialised into the page — an unstable sort
   * would change the server and client payloads between renders for no reason.
   */
  it('is ordered heaviest first, then alphabetically, and is stable', () => {
    const input = [
      ['a', 'b'],
      ['a', 'b'],
      ['x', 'y'],
      ['a', 'c'],
    ];
    const once = buildSpecialtyLinks(input);
    expect(once.map((l) => `${l.a}-${l.b}:${l.weight}`)).toEqual(['a-b:2', 'a-c:1', 'x-y:1']);
    expect(buildSpecialtyLinks(input)).toEqual(once);
  });

  it('handles an empty directory', () => {
    expect(buildSpecialtyLinks([])).toEqual([]);
  });

  /**
   * Slugs are the key, joined by a space. Slugs never contain spaces, so the key round-trips —
   * this asserts the split cannot corrupt a name.
   */
  it('round-trips multi-hyphen slugs without corrupting them', () => {
    const links = buildSpecialtyLinks([['stress-sleep-optimization', 'hair-tissue-mineral-analysis']]);
    expect(links[0].a).toBe('hair-tissue-mineral-analysis');
    expect(links[0].b).toBe('stress-sleep-optimization');
  });
});
