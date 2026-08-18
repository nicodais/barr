import { beforeEach, describe, expect, it } from 'vitest';

import {
  CHUNK_SIZE,
  FLAT_EDGES,
  LOD_RESOLUTIONS,
  PHYSICS_RESOLUTION,
  buildChunkGeometry,
  buildChunkHeightSamples,
} from '../src/terrain/chunkGeometry';
import { heightAt, refreshRegion } from '../src/terrain/height';
import { REGION_ORDER, setActiveRegion } from '../src/terrain/regions';

/**
 * The physics and render paths must sample the same ground.
 *
 * `buildChunkGeometry` (what you see) and `buildChunkHeightSamples` (what you
 * drive on) both walk `heightAt` over a chunk, independently, with separately
 * written coordinate arithmetic — one from the chunk origin, one from its
 * centre. Neither function's own unit test would notice them drifting apart,
 * and the symptom if they do is not a crash: the car drives on ground that is
 * not the ground being drawn, everywhere, all the time.
 *
 * That makes this one assertion worth more than its size suggests, which is
 * why it gets a file rather than a line in another one.
 */

const CHUNKS: Array<[number, number]> = [
  [0, 0],
  [1, 0],
  [0, -1],
  [-2, 3],
  [5, -4],
];

/** Grid vertex `(ix, iz)` of the render mesh, ignoring the skirt that follows it. */
function renderHeight(pos: Float32Array, n: number, ix: number, iz: number) {
  return pos[(ix * (n + 1) + iz) * 3 + 1];
}

describe.each(REGION_ORDER)('%s', (region) => {
  beforeEach(() => {
    setActiveRegion(region);
    refreshRegion();
  });

  it.each(CHUNKS)('renders the ground physics collides with at chunk %i,%i', (cx, cz) => {
    const n = PHYSICS_RESOLUTION;
    const physics = buildChunkHeightSamples(cx, cz);
    const geometry = buildChunkGeometry(cx, cz, n, FLAT_EDGES);
    const pos = geometry.getAttribute('position').array as Float32Array;

    expect(physics.length).toBe((n + 1) * (n + 1));

    for (let ix = 0; ix <= n; ix++) {
      for (let iz = 0; iz <= n; iz++) {
        expect(
          renderHeight(pos, n, ix, iz),
          `chunk ${cx},${cz} vertex ${ix},${iz}`,
        ).toBe(physics[iz + ix * (n + 1)]);
      }
    }
    geometry.dispose();
  });

  it.each(CHUNKS)('puts chunk %i,%i where the world says it is', (cx, cz) => {
    // Guards the coordinate arithmetic itself: the two builders derive world
    // positions differently (origin vs centre), so agreeing with each other
    // but not with `heightAt` would still be wrong.
    //
    // `Math.fround` because both builders store into a Float32Array while
    // `heightAt` computes in float64 — the narrowing is the storage format, not
    // a disagreement about where the ground is.
    const n = PHYSICS_RESOLUTION;
    const physics = buildChunkHeightSamples(cx, cz);
    const cell = CHUNK_SIZE / n;
    for (const ix of [0, n >> 1, n]) {
      for (const iz of [0, n >> 1, n]) {
        const wx = cx * CHUNK_SIZE + ix * cell;
        const wz = cz * CHUNK_SIZE + iz * cell;
        expect(physics[iz + ix * (n + 1)], `${wx},${wz}`).toBe(Math.fround(heightAt(wx, wz)));
      }
    }
  });
});

describe('chunk seams', () => {
  beforeEach(() => {
    setActiveRegion('liwa');
    refreshRegion();
  });

  it('gives neighbouring chunks identical shared-edge vertices', () => {
    // The watertightness argument in buildChunkGeometry's docblock: shared edge
    // vertices must be bitwise identical, or the seam shows as a hairline crack
    // and prints a dashed shadow along the chunk boundary.
    const n = LOD_RESOLUTIONS[0];
    const left = buildChunkGeometry(0, 0, n, FLAT_EDGES);
    const right = buildChunkGeometry(1, 0, n, FLAT_EDGES);
    const lp = left.getAttribute('position').array as Float32Array;
    const rp = right.getAttribute('position').array as Float32Array;

    for (let iz = 0; iz <= n; iz++) {
      // Left chunk's east edge (ix = n) is the right chunk's west edge (ix = 0).
      const a = (n * (n + 1) + iz) * 3;
      const b = (0 * (n + 1) + iz) * 3;
      expect(lp[a], `x at iz=${iz}`).toBe(rp[b]);
      expect(lp[a + 1], `y at iz=${iz}`).toBe(rp[b + 1]);
      expect(lp[a + 2], `z at iz=${iz}`).toBe(rp[b + 2]);
    }
    left.dispose();
    right.dispose();
  });

  it('builds finite geometry at every LOD', () => {
    for (const n of LOD_RESOLUTIONS) {
      const geometry = buildChunkGeometry(0, 0, n, FLAT_EDGES);
      const pos = geometry.getAttribute('position').array as Float32Array;
      const col = geometry.getAttribute('color').array as Float32Array;
      expect(pos.every(Number.isFinite), `positions at LOD ${n}`).toBe(true);
      expect(col.every((c) => c >= 0 && c <= 1), `colours at LOD ${n}`).toBe(true);
      geometry.dispose();
    }
  });
});
