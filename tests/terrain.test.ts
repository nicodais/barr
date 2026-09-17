import { beforeEach, describe, expect, it } from 'vitest';

import {
  WORLD_HALF,
  clamp01,
  crestNear,
  hash2,
  heightAt,
  refreshRegion,
  smoothstep,
  softnessAt,
  surfaceAt,
} from '../src/terrain/height';
import { REGION_ORDER, setActiveRegion } from '../src/terrain/regions';

/**
 * The height field.
 *
 * This module is 930 lines, documented as deterministic and side-effect free,
 * and it is the ground truth that the physics heightfields, the render chunks
 * and the traction model all read. Nothing else in the repo has this much
 * downstream reach, and its failures are silent: the `hash2` overflow recorded
 * at height.ts:55 returned [0, 0.5] with a mean of 0.25 instead of 0.5, which
 * starved every `smoothstep` window downstream and flattened the entire world.
 * It threw nothing. It was found by noticing the world looked wrong.
 *
 * So these are mostly property assertions over a sampled grid rather than
 * fixed expected values — the point is not to pin the terrain to a golden
 * output, which would break on every legitimate tuning change, but to hold the
 * invariants the field claims about itself.
 */

/** A deterministic sweep of the playable area. */
function* grid(step = 64) {
  for (let x = -WORLD_HALF; x <= WORLD_HALF; x += step) {
    for (let z = -WORLD_HALF; z <= WORLD_HALF; z += step) yield [x, z] as const;
  }
}

beforeEach(() => {
  setActiveRegion('liwa');
  refreshRegion();
});

describe('hash2', () => {
  it('is uniform over [0, 1)', () => {
    // The regression guard for the float64 overflow. `Math.imul` is load
    // bearing here: plain `*` pushes the product past 2^53 and rounds away the
    // low bits, which are the entire point of a hash.
    let sum = 0;
    let n = 0;
    let min = 1;
    let max = 0;
    for (let ix = -200; ix < 200; ix++) {
      for (let iz = -200; iz < 200; iz++) {
        const v = hash2(ix, iz);
        sum += v;
        n++;
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
    }
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThan(1);
    // The broken version scored 0.25 here. A tolerance this tight is safe for
    // 160k samples of a decent hash and still catches a halved range.
    expect(sum / n).toBeGreaterThan(0.49);
    expect(sum / n).toBeLessThan(0.51);
  });

  it('spreads across the whole range rather than clustering', () => {
    const buckets = new Array(10).fill(0);
    for (let ix = 0; ix < 320; ix++) {
      for (let iz = 0; iz < 320; iz++) {
        buckets[Math.min(9, Math.floor(hash2(ix, iz) * 10))]++;
      }
    }
    // Every decile within 25% of even. The broken hash left the top five empty.
    const even = (320 * 320) / 10;
    for (const [i, count] of buckets.entries()) {
      expect(count, `decile ${i}`).toBeGreaterThan(even * 0.75);
      expect(count, `decile ${i}`).toBeLessThan(even * 1.25);
    }
  });

  it('is deterministic and order-sensitive', () => {
    expect(hash2(17, -3)).toBe(hash2(17, -3));
    expect(hash2(17, -3)).not.toBe(hash2(-3, 17));
  });
});

describe('clamp01', () => {
  it('clamps at both edges and passes the middle through', () => {
    expect(clamp01(-5)).toBe(0);
    expect(clamp01(0)).toBe(0);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(1)).toBe(1);
    expect(clamp01(5)).toBe(1);
  });
});

describe('smoothstep', () => {
  it('is 0 at and below edge0, 1 at and above edge1', () => {
    expect(smoothstep(2, 6, 1)).toBe(0);
    expect(smoothstep(2, 6, 2)).toBe(0);
    expect(smoothstep(2, 6, 6)).toBe(1);
    expect(smoothstep(2, 6, 9)).toBe(1);
  });

  it('is monotonic across the window and symmetric about its midpoint', () => {
    let prev = -1;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const v = smoothstep(0, 1, t);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5, 10);
    expect(smoothstep(0, 1, 0.25) + smoothstep(0, 1, 0.75)).toBeCloseTo(1, 10);
  });

  it('handles an inverted window', () => {
    expect(smoothstep(6, 2, 9)).toBe(0);
    expect(smoothstep(6, 2, 1)).toBe(1);
  });

  it('returns a number for a degenerate window', () => {
    // edge0 === edge1 divides by zero. Off the window the sign of the
    // numerator still resolves it, but exactly on the edge it is 0/0 -> NaN,
    // and NaN in the height field is a hole in the world.
    expect(smoothstep(5, 5, 9)).toBe(1);
    expect(smoothstep(5, 5, 1)).toBe(0);
    expect(Number.isNaN(smoothstep(5, 5, 5))).toBe(false);
  });
});

describe.each(REGION_ORDER)('%s height field', (region) => {
  beforeEach(() => {
    setActiveRegion(region);
    refreshRegion();
  });

  it('is finite everywhere in bounds', () => {
    // A NaN here is a hole the car falls through and a physics explosion.
    for (const [x, z] of grid()) {
      expect(Number.isFinite(heightAt(x, z)), `heightAt(${x}, ${z})`).toBe(true);
    }
  });

  it('stays within a sane vertical range', () => {
    let min = Infinity;
    let max = -Infinity;
    for (const [x, z] of grid()) {
      const y = heightAt(x, z);
      min = Math.min(min, y);
      max = Math.max(max, y);
    }
    expect(max - min).toBeGreaterThan(10);
    expect(max).toBeLessThan(500);
    expect(min).toBeGreaterThan(-500);
  });

  it('is deterministic', () => {
    for (const [x, z] of grid(256)) expect(heightAt(x, z)).toBe(heightAt(x, z));
  });

  it('is continuous — no cliffs between adjacent samples', () => {
    // A step between neighbouring samples is a wall the car hits at speed. The
    // scarp side of a jebel is the steepest thing here by design, so this is a
    // loose bound aimed at discontinuities, not at slope tuning.
    const e = 1;
    for (const [x, z] of grid(97)) {
      const dx = Math.abs(heightAt(x + e, z) - heightAt(x - e, z));
      const dz = Math.abs(heightAt(x, z + e) - heightAt(x, z - e));
      expect(dx, `d/dx at ${x},${z}`).toBeLessThan(2 * e * 4);
      expect(dz, `d/dz at ${x},${z}`).toBeLessThan(2 * e * 4);
    }
  });

  it('reports surface fields in range', () => {
    for (const [x, z] of grid(128)) {
      const s = surfaceAt(x, z);
      for (const [key, v] of Object.entries(s)) {
        expect(Number.isFinite(v), `${key} at ${x},${z}`).toBe(true);
        expect(v, `${key} at ${x},${z}`).toBeGreaterThanOrEqual(0);
        expect(v, `${key} at ${x},${z}`).toBeLessThanOrEqual(1);
      }
      expect(softnessAt(x, z)).toBe(s.softness);
    }
  });

  it('returns a usable crest for any point', () => {
    for (const [x, z] of grid(256)) {
      const c = crestNear(x, z);
      for (const v of [c.x, c.z, c.y, c.amp, c.softness]) expect(Number.isFinite(v)).toBe(true);
      expect(c.y).toBeCloseTo(heightAt(c.x, c.z), 6);
      expect(c.softness).toBeGreaterThanOrEqual(0);
      expect(c.softness).toBeLessThanOrEqual(1);
    }
  });
});

describe('refreshRegion', () => {
  it('actually changes the ground when the region changes', () => {
    setActiveRegion('liwa');
    refreshRegion();
    const liwa = [...grid(256)].map(([x, z]) => heightAt(x, z));

    setActiveRegion('fossilrock');
    refreshRegion();
    const fossil = [...grid(256)].map(([x, z]) => heightAt(x, z));
    expect(fossil).not.toEqual(liwa);

    // And the round trip restores it exactly — no cached state left behind.
    setActiveRegion('liwa');
    refreshRegion();
    expect([...grid(256)].map(([x, z]) => heightAt(x, z))).toEqual(liwa);
  });
});
