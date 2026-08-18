import { describe, expect, it } from 'vitest';

import { timeBand } from '../src/narrative/Director';
import type { TimeBand } from '../src/narrative/Director';
import { emptyWheelState, mergeAxle } from '../src/vehicle/twoWheeled';
import {
  DEFAULT_PRESSURE,
  PRESSURE_STEPS,
  isPressureId,
  pressureAxis,
  pressureStep,
  pressureTuning,
  psiAt,
  softnessScale,
} from '../src/vehicle/tyrePressure';
import { DEFAULT_TUNING } from '../src/vehicle/VehicleTuning';

/**
 * The pure maths the driving model and the radio sit on. None of it needs
 * Rapier, Three or a browser — which is the whole reason it is worth testing,
 * because the parts that do need them are tuned by feel and belong in a
 * playtest instead (§2).
 */

describe('timeBand', () => {
  const bands: TimeBand[] = ['dawn', 'midday', 'dusk', 'nightfall'];

  it('is gapless across the cycle', () => {
    // The docblock claims every `t` belongs to exactly one band, so the
    // crossings are what fire. A gap would be a band that never triggers.
    for (let t = 0; t < 1; t += 0.001) {
      expect(bands, `t=${t.toFixed(3)}`).toContain(timeBand(t));
    }
  });

  it('reaches every band', () => {
    const seen = new Set<TimeBand>();
    for (let t = 0; t < 1; t += 0.001) seen.add(timeBand(t));
    expect([...seen].sort()).toEqual([...bands].sort());
  });

  it('wraps rather than falling off either end', () => {
    // The negative-modulo normalisation. A raw `t % 1` would go negative here
    // and drop out of every band.
    for (let t = -2; t <= 2; t += 0.01) {
      expect(bands, `t=${t.toFixed(2)}`).toContain(timeBand(t));
      expect(timeBand(t)).toBe(timeBand(t + 1));
    }
  });

  it('puts the documented edges in the documented bands', () => {
    expect(timeBand(0)).toBe('nightfall');
    expect(timeBand(0.04)).toBe('nightfall');
    expect(timeBand(0.05)).toBe('dawn');
    expect(timeBand(0.3)).toBe('midday');
    expect(timeBand(0.62)).toBe('dusk');
    expect(timeBand(0.93)).toBe('nightfall');
  });
});

describe('mergeAxle', () => {
  const wheel = (over: Partial<ReturnType<typeof emptyWheelState>> = {}) => ({
    ...emptyWheelState(),
    contact: true,
    ...over,
  });

  it('averages two contacts onto the centre line', () => {
    // The motorcycle gets four raycasts at a 4x4's hard-points, so anything
    // reading wheel contacts leaves two ruts a track-width apart unless the
    // pairs are merged first (7afe2ac).
    const out = mergeAxle(
      wheel({ contactX: -1, contactZ: 2, y: 0.2, softness: 0.2, compression: 0.4 }),
      wheel({ contactX: 1, contactZ: 2, y: 0.4, softness: 0.6, compression: 0.8 }),
      emptyWheelState(),
    );
    expect(out.contact).toBe(true);
    expect(out.contactX).toBe(0);
    expect(out.contactZ).toBe(2);
    expect(out.softness).toBeCloseTo(0.4);
    expect(out.compression).toBeCloseTo(0.6);
    expect(out.y).toBeCloseTo(0.3);
    // Always on the centre line — that is the entire point of the merge.
    expect(out.x).toBe(0);
  });

  it('returns a unit normal', () => {
    // The merged normal is fed to anything orienting a track decal or a dust
    // emitter. An un-normalised average silently scales whatever reads it.
    for (const [a, b] of [
      [{ normalX: 0, normalY: 1, normalZ: 0 }, { normalX: 0.6, normalY: 0.8, normalZ: 0 }],
      [{ normalX: -0.7, normalY: 0.7, normalZ: 0 }, { normalX: 0.7, normalY: 0.7, normalZ: 0 }],
      [{ normalX: 0, normalY: 0.6, normalZ: 0.8 }, { normalX: 0, normalY: 1, normalZ: 0 }],
    ]) {
      const out = mergeAxle(wheel(a), wheel(b), emptyWheelState());
      expect(Math.hypot(out.normalX, out.normalY, out.normalZ)).toBeCloseTo(1, 10);
    }
  });

  it('does not report a contact unless both wheels are down', () => {
    // Averaging a contact with a non-contact drags the merged point somewhere
    // that is not on the surface.
    expect(mergeAxle(wheel(), wheel({ contact: false }), emptyWheelState()).contact).toBe(false);
    expect(mergeAxle(wheel({ contact: false }), wheel(), emptyWheelState()).contact).toBe(false);
  });

  it('survives a missing wheel rather than throwing mid-step', () => {
    const missing = undefined as unknown as ReturnType<typeof emptyWheelState>;
    expect(() => mergeAxle(missing, wheel(), emptyWheelState())).not.toThrow();
  });
});

describe('tyre pressure', () => {
  it('recognises exactly the three steps', () => {
    for (const step of PRESSURE_STEPS) expect(isPressureId(step.id)).toBe(true);
    for (const junk of ['flat', '', null, 7, undefined]) expect(isPressureId(junk)).toBe(false);
    expect(isPressureId(DEFAULT_PRESSURE)).toBe(true);
  });

  it('gives every step a label and a hint for the menu', () => {
    for (const step of PRESSURE_STEPS) {
      expect(step.label.trim()).not.toBe('');
      expect(step.hint.trim()).not.toBe('');
      expect(step.psi).toBeGreaterThan(0);
    }
  });

  it('orders the axis from sand to road', () => {
    expect(pressureAxis('sand')).toBe(0);
    expect(pressureAxis('road')).toBe(1);
    expect(pressureAxis('mixed')).toBeGreaterThan(0);
    expect(pressureAxis('mixed')).toBeLessThan(1);
  });

  it('falls back to the middle step for an unknown id', () => {
    expect(pressureStep('nonsense' as never)).toBe(PRESSURE_STEPS[1]);
  });

  it('reads back each step\'s own psi at its own axis position', () => {
    // The piecewise interpolation exists because the steps are 15/22/35 and
    // deliberately unevenly spaced — a straight line end to end read 25 psi
    // while the menu chip said 22.
    for (const step of PRESSURE_STEPS) {
      expect(psiAt(pressureAxis(step.id))).toBeCloseTo(step.psi, 6);
    }
  });

  it('interpolates psi monotonically and clamps outside 0..1', () => {
    let prev = -Infinity;
    for (let a = 0; a <= 1.0001; a += 0.01) {
      const psi = psiAt(a);
      expect(psi).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = psi;
    }
    expect(psiAt(-5)).toBe(PRESSURE_STEPS[0].psi);
    expect(psiAt(5)).toBe(PRESSURE_STEPS[PRESSURE_STEPS.length - 1].psi);
  });

  it('makes soft tyres read the sand as firmer', () => {
    // The one multiplier the whole mechanic is built on.
    expect(softnessScale(0)).toBeLessThan(softnessScale(1));
    expect(softnessScale(1)).toBeCloseTo(1, 10);
    expect(softnessScale(0)).toBeGreaterThan(0);
  });

  it('charges airing down on firm ground, and nothing at road pressure', () => {
    // Without an explicit cost the sand model has no notion of a tyre being
    // too soft, so airing down would be free and nobody would ever air up.
    const road = pressureTuning(DEFAULT_TUNING, 1);
    const sand = pressureTuning(DEFAULT_TUNING, 0);

    for (const key of ['hardpackGrip', 'hardpackSideGrip', 'topSpeed', 'steerRate'] as const) {
      expect(road[key], key).toBeCloseTo(DEFAULT_TUNING[key], 10);
      expect(sand[key], key).toBeLessThan(DEFAULT_TUNING[key]);
    }
    // Softer sidewall, softer ride — this one goes the other way.
    expect(sand.suspensionStiffness).toBeLessThan(DEFAULT_TUNING.suspensionStiffness);
    expect(sand.suspensionCompression).toBeGreaterThan(DEFAULT_TUNING.suspensionCompression);
  });

  it('moves every affected field monotonically along the axis', () => {
    const keys = [
      'hardpackGrip',
      'hardpackSideGrip',
      'topSpeed',
      'steerRate',
      'suspensionStiffness',
      'suspensionCompression',
    ] as const;
    const samples = [0, 0.25, 0.5, 0.75, 1].map((a) => pressureTuning(DEFAULT_TUNING, a));
    for (const key of keys) {
      const series = samples.map((s) => s[key]);
      const rising = series.every((v, i) => i === 0 || v >= series[i - 1] - 1e-9);
      const falling = series.every((v, i) => i === 0 || v <= series[i - 1] + 1e-9);
      expect(rising || falling, `${key} is not monotonic: ${series.join(', ')}`).toBe(true);
    }
  });

  it('leaves the base tuning untouched', () => {
    const before = { ...DEFAULT_TUNING };
    pressureTuning(DEFAULT_TUNING, 0);
    expect(DEFAULT_TUNING).toEqual(before);
  });
});
