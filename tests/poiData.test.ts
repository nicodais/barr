import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { POI_INFO } from '../src/data/poiInfo';
import type { Poi } from '../src/data/pois';
import { REGIONS, REGION_ORDER } from '../src/terrain/regions';
import { WORLD_HALF } from '../src/terrain/height';

/**
 * Data invariants for the points of interest.
 *
 * This is the cheapest suite in the repo and it exists because the most common
 * change to this project is a hand edit to a data file, made in one region,
 * that quietly breaks another. The arrival cards captioning Al Badayer's live
 * transmission line as an abandoned oil survey (5a8fb44) is the canonical case:
 * nothing threw, nothing looked broken, the text was just false. So is the
 * majlis photo, which 404'd into PoiCard's `.svg` fallback and rendered the
 * placeholder postcard convincingly enough that nobody noticed for months.
 *
 * Every assertion below is one someone would otherwise have to make by eye,
 * across three regions, on every content edit.
 */

const publicDir = fileURLToPath(new URL('../public', import.meta.url));
const regions = REGION_ORDER.map((id) => [id, REGIONS[id]] as const);

/** The card actually shown: the per-kind entry with any per-POI override merged over it. */
function resolveCard(poi: Poi) {
  return { ...POI_INFO[poi.id], ...poi.info };
}

describe.each(regions)('%s', (_id, region) => {
  it('places every POI inside the world bounds', () => {
    for (const poi of region.pois) {
      expect(Math.abs(poi.x), `${poi.name} x`).toBeLessThanOrEqual(WORLD_HALF);
      expect(Math.abs(poi.z), `${poi.name} z`).toBeLessThanOrEqual(WORLD_HALF);
    }
  });

  it('gives every POI a distinct kind', () => {
    // The kind is the identity used for discovery and for the card lookup, so
    // two POIs sharing one in a region would make the second undiscoverable.
    const ids = region.pois.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every POI at least one line for Ahmed', () => {
    // Director.callPoi returns early on an empty pool rather than keying up to
    // say `undefined`, but a POI nobody wrote lines for is still a content bug.
    for (const poi of region.pois) {
      expect(poi.lines.length, `${poi.name} has no lines`).toBeGreaterThan(0);
      for (const line of poi.lines) expect(line.trim()).not.toBe('');
    }
  });

  it('keeps POI trigger radii from overlapping', () => {
    // Two overlapping radii mean one parking spot discovers two POIs, and
    // because the POI loop sits above the cooldown check, Ahmed signs off and
    // immediately keys back up. §5 asks for dialogue that is sparse.
    for (let i = 0; i < region.pois.length; i++) {
      for (let j = i + 1; j < region.pois.length; j++) {
        const a = region.pois[i];
        const b = region.pois[j];
        const gap = Math.hypot(a.x - b.x, a.z - b.z) - (a.radius + b.radius);
        expect(gap, `${a.name} overlaps ${b.name} by ${(-gap).toFixed(0)}m`).toBeGreaterThan(0);
      }
    }
  });

  it('resolves a card for every POI', () => {
    for (const poi of region.pois) {
      const card = resolveCard(poi);
      expect(card.title, `${poi.name} has no card title`).toBeTruthy();
      expect(card.body, `${poi.name} has no card body`).toBeTruthy();
    }
  });

  it('does not let one region inherit another region\'s card', () => {
    // POI_INFO is keyed by kind, which is right for the encyclopaedic entries —
    // a ghaf is a ghaf in any emirate. It stops being right when a region
    // reuses a kind for a factually different spot, which is what shipped in
    // 5a8fb44: Big Red captioned as Tal Moreeb, a power line as an oil survey.
    // A card whose title names a *different* region's POI is the tell.
    for (const poi of region.pois) {
      const title = resolveCard(poi).title;
      for (const [otherId, other] of regions) {
        if (otherId === region.id) continue;
        const twin = other.pois.find((p) => p.id === poi.id);
        if (!twin) continue;
        const twinTitle = resolveCard(twin).title;
        if (twinTitle !== title) continue;
        // Sharing a title is only legitimate when neither region overrode it —
        // i.e. both genuinely mean the same encyclopaedic thing.
        expect(
          poi.info?.title === undefined && twin.info?.title === undefined,
          `${region.id}/${poi.name} and ${otherId}/${twin.name} both show "${title}"`,
        ).toBe(true);
      }
    }
  });

  it('points every card photo at a file that exists', () => {
    // The majlis card asked for /photos/majlis.jpg while the file on disk was
    // majilis.jpg. PoiCard falls back to the .svg postcard on error, so the
    // card looked deliberate and the real photograph was never seen. The
    // fallback is good design; this is what stops it hiding the next typo.
    for (const poi of region.pois) {
      const photo = resolveCard(poi).photo;
      if (!photo) continue;
      expect(photo.startsWith('/'), `${poi.name} photo is not an absolute path`).toBe(true);
      expect(existsSync(`${publicDir}${photo}`), `${poi.name} photo missing: ${photo}`).toBe(true);
    }
  });

  it('credits every photo it shows', () => {
    for (const poi of region.pois) {
      const card = resolveCard(poi);
      if (card.photo) expect(card.credit, `${poi.name} photo has no credit`).toBeTruthy();
    }
  });
});

describe('POI_INFO', () => {
  it('has an entry for every kind any region places', () => {
    for (const [, region] of regions) {
      for (const poi of region.pois) {
        expect(POI_INFO[poi.id], `no POI_INFO entry for '${poi.id}'`).toBeDefined();
      }
    }
  });
});
