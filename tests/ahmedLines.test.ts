import { describe, expect, it } from 'vitest';

import { AHMED_LINES, AHMED_REGION_LINES, AHMED_VEHICLE_LINES } from '../src/data/ahmedLines';
import type { LinePool } from '../src/data/ahmedLines';
import { BODY_OPTIONS } from '../src/vehicle/vehicleConfig';
import { REGION_ORDER, REGIONS } from '../src/terrain/regions';

/**
 * Ahmed's line pools (§13).
 *
 * The Director draws from a pool at random and retires the line for the
 * session, cycling back only once the pool is exhausted. That rule is only
 * worth anything if the pool is non-empty, and only *works* if the lines in it
 * are actually distinct — a duplicated line is a line that can be heard twice
 * in a session that was meant to retire it, and spotting one by re-reading a
 * 30-line pool by eye at every edit does not scale.
 *
 * `take` also indexes into the pool it is handed, so an empty pool is an
 * `undefined` subtitle rather than silence.
 */

const POOLS: LinePool[] = [
  'signOn',
  'stuck',
  'fast',
  'airborne',
  'rollover',
  'stormIn',
  'stormOut',
  'airedDown',
  'airedUp',
  'pressureHint',
  'nightfall',
  'dawn',
  'midday',
  'dusk',
  'signOff',
];

/** Every table Ahmed draws from, flattened to (label, lines) so the rules apply once. */
const tables: Array<[string, string[]]> = [
  ...POOLS.map((pool) => [`AHMED_LINES.${pool}`, AHMED_LINES[pool]] as [string, string[]]),
  ...BODY_OPTIONS.map(
    (body) => [`AHMED_VEHICLE_LINES.${body.id}`, AHMED_VEHICLE_LINES[body.id]] as [string, string[]],
  ),
  ...REGION_ORDER.map(
    (id) => [`AHMED_REGION_LINES.${id}`, AHMED_REGION_LINES[id]] as [string, string[]],
  ),
];

describe('line pools', () => {
  it('covers every LinePool the Director can ask for', () => {
    // Keys, not just values: a pool added to the union but not the table is a
    // crash the type system does catch, and one removed from the union but
    // still populated is dead content it does not.
    expect(Object.keys(AHMED_LINES).sort()).toEqual([...POOLS].sort());
  });

  it('covers every vehicle the garage can build', () => {
    expect(Object.keys(AHMED_VEHICLE_LINES).sort()).toEqual(BODY_OPTIONS.map((b) => b.id).sort());
  });

  it('covers every region', () => {
    expect(Object.keys(AHMED_REGION_LINES).sort()).toEqual([...REGION_ORDER].sort());
  });

  it.each(tables)('%s is non-empty and free of blank lines', (_label, lines) => {
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line.trim()).not.toBe('');
  });

  it.each(tables)('%s has no duplicates', (_label, lines) => {
    const seen = new Map<string, number>();
    for (const line of lines) seen.set(line, (seen.get(line) ?? 0) + 1);
    const dupes = [...seen].filter(([, n]) => n > 1).map(([line]) => line);
    expect(dupes).toEqual([]);
  });

  it.each(tables)('%s keeps to one-liners', (_label, lines) => {
    // §13: "One-liners only — if a moment needs more, it's two separate short
    // call-ins, not one long one." The subtitle strip is one line on a phone.
    for (const line of lines) expect(line.length, line).toBeLessThanOrEqual(140);
  });
});

describe('POI lines', () => {
  it('are distinct within a region', () => {
    // A POI beat repeated at another POI reads as Ahmed losing track of where
    // you are, which is the one thing his character is not.
    for (const id of REGION_ORDER) {
      const lines = REGIONS[id].pois.flatMap((p) => p.lines);
      const seen = new Map<string, number>();
      for (const line of lines) seen.set(line, (seen.get(line) ?? 0) + 1);
      expect(
        [...seen].filter(([, n]) => n > 1).map(([line]) => `${id}: ${line}`),
      ).toEqual([]);
    }
  });
});
