import { beforeEach, describe, expect, it } from 'vitest';

import { loadProgress, saveProgress } from '../src/settings/Progress';
import { setActiveRegion } from '../src/terrain/regions';
import { installStorage, type MemoryStorage } from './localStorageStub';

/**
 * Discovery persistence, and specifically the cross-region bug that shipped.
 *
 * `PoiKind` is a shared catalogue by design, so most kinds exist in more than
 * one region. Progress used to live under one flat key, filtered against the
 * active region on load, which meant the two deserts could see each other's
 * saves. The round trip below is the test that fixture could never pass.
 */

let store: MemoryStorage;

beforeEach(() => {
  store = installStorage();
  setActiveRegion('liwa');
});

describe('loadProgress / saveProgress', () => {
  it('round-trips discoveries within a region', () => {
    saveProgress({ discovered: new Set(['ghaf', 'falaj']) });
    expect([...loadProgress().discovered].sort()).toEqual(['falaj', 'ghaf']);
  });

  it('starts a fresh region empty', () => {
    setActiveRegion('badayer');
    expect(loadProgress().discovered.size).toBe(0);
  });

  it('does not credit one region for another region\'s discoveries', () => {
    // Both regions have a ghaf and a falaj. Finding Liwa's must not mark Fossil
    // Rock's as found — that put the counter at 2/10 in a desert never driven,
    // and stopped the compass pointing at either.
    setActiveRegion('liwa');
    saveProgress({ discovered: new Set(['ghaf', 'falaj']) });

    setActiveRegion('fossilrock');
    expect(loadProgress().discovered.size).toBe(0);
  });

  it('does not delete one region\'s progress when another region saves', () => {
    // The severe half of the bug. Load filtered the shared array to the active
    // region, then the next save wrote that filtered set back over the key —
    // so a Fossil-Rock-only find was destroyed by the next discovery in Liwa.
    setActiveRegion('fossilrock');
    saveProgress({ discovered: new Set(['fossilbed', 'tomb']) });

    setActiveRegion('liwa');
    const liwa = loadProgress();
    liwa.discovered.add('oilwell');
    saveProgress(liwa);

    setActiveRegion('fossilrock');
    expect([...loadProgress().discovered].sort()).toEqual(['fossilbed', 'tomb']);
  });

  it('survives a full three-region tour', () => {
    const tour = [
      ['liwa', ['ghaf', 'oilwell']],
      ['fossilrock', ['fossilbed', 'tomb']],
      ['badayer', ['pylons', 'oasis']],
    ] as const;

    for (const [region, found] of tour) {
      setActiveRegion(region);
      saveProgress({ discovered: new Set(found) });
    }
    for (const [region, found] of tour) {
      setActiveRegion(region);
      expect([...loadProgress().discovered].sort()).toEqual([...found].sort());
    }
  });

  it('drops ids the active region no longer places', () => {
    // Still the right defence against a stale blob: a retired POI must not
    // make the counter read 12 out of 10.
    setActiveRegion('liwa');
    store.setItem(
      'dune.progress.v2.liwa',
      JSON.stringify({ discovered: ['ghaf', 'fossilbed', 'nonsense'] }),
    );
    expect([...loadProgress().discovered]).toEqual(['ghaf']);
  });

  it('migrates a legacy single-key save into the region the player left off in', () => {
    // A v1 blob's contents belong to whichever region was last active, which is
    // what settings restore on boot before this runs.
    store.setItem('dune.progress.v1', JSON.stringify({ discovered: ['ghaf', 'oilwell'] }));
    setActiveRegion('liwa');

    expect([...loadProgress().discovered].sort()).toEqual(['ghaf', 'oilwell']);
    // Taken over and retired, so the next region opened does not read it too.
    expect(store.getItem('dune.progress.v1')).toBeNull();
    expect(store.getItem('dune.progress.v2.liwa')).not.toBeNull();
    setActiveRegion('fossilrock');
    expect(loadProgress().discovered.size).toBe(0);
  });

  it('returns an empty set rather than throwing on corrupt storage', () => {
    for (const junk of ['{', 'null', '[]', '{"discovered":7}', '""']) {
      store.clear();
      store.setItem('dune.progress.v2.liwa', junk);
      expect(() => loadProgress()).not.toThrow();
      expect(loadProgress().discovered.size).toBe(0);
    }
  });

  it('does not interrupt a drive when storage refuses writes', () => {
    store.failWrites = true;
    expect(() => saveProgress({ discovered: new Set(['ghaf']) })).not.toThrow();
  });
});
