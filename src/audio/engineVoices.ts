import type { BodyId } from '../vehicle/vehicleConfig';

/**
 * Per-body engine character (§2, backlog 9).
 *
 * Seven bodies shared one voice, so a 240kg single-cylinder bike and a
 * 2.65-tonne V8 pickup were audibly the same vehicle. That quietly undoes a lot
 * of what BODY_TUNING achieves: the engine note is how you read the traction
 * model by ear — whether you are bogging, whether the climb is going to stall,
 * whether you are about to run out of gear — and one note for everything means
 * that channel says nothing about what you chose.
 *
 * The synth is three oscillators through a lowpass (see DrivingSound), which is
 * enough handles to separate these convincingly without shipping a byte of
 * sample data. What actually distinguishes them, in rough order of how much
 * work each does:
 *
 *  - `idleHz`/`spanHz` — where the note sits and how far it climbs. A big lazy
 *    V8 lives an octave under a thumper and never gets near its range.
 *  - the harmonic mix — `sub` is the octave-down sine that makes something read
 *    as large; `square` is the hard edge that reads as clatter or rasp. A
 *    single-cylinder needs its fundamental loud and its sub almost absent, which
 *    is the exact inverse of the pickup.
 *  - `gears`/`gearTop` — the *rhythm* of the shift points. Four long gears to
 *    30 m/s and six short ones to 43 are different instruments before you have
 *    changed a single frequency.
 *
 * `gearTop` tracks each body's `topSpeed` in BODY_TUNING so the last shift lands
 * near where the vehicle actually stops accelerating. Keep them in step.
 */
export interface EngineVoice {
  /** Fundamental at idle, Hz. */
  idleHz: number;
  /** Added to the fundamental at redline. */
  spanHz: number;
  /** Number of ratios. More gears = more frequent, shorter sweeps. */
  gears: number;
  /** Speed (m/s) at the top of top gear — roughly the body's top speed. */
  gearTop: number;
  /** Octave-down sine. Size. */
  sub: number;
  /** Sawtooth at the fundamental. Body. */
  saw: number;
  /** Square an octave up. Edge, clatter, rasp. */
  square: number;
  /** Lowpass cutoff at idle, Hz, and how far it opens by redline. */
  cutoffHz: number;
  cutoffSpan: number;
  /** Overall trim, so a bright voice doesn't arrive louder than a dark one. */
  level: number;
}

export const ENGINE_VOICES: Record<BodyId, EngineVoice> = {
  // The baseline: a big lazy petrol six. Every other voice is described
  // relative to this one.
  wagon: {
    idleHz: 38, spanHz: 118, gears: 5, gearTop: 33,
    sub: 0.5, saw: 0.22, square: 0.06,
    cutoffHz: 380, cutoffSpan: 1500, level: 0.22,
  },

  // V8, and heavy with it. Lowest and darkest here, with the sub carrying most
  // of the note — four long gears so it lugs rather than shifts.
  pickup: {
    idleHz: 29, spanHz: 90, gears: 4, gearTop: 30,
    sub: 0.64, saw: 0.19, square: 0.05,
    cutoffHz: 290, cutoffSpan: 1120, level: 0.25,
  },

  // Also a V8, but a tighter, harder-edged one — same size, more bark.
  gwagon: {
    idleHz: 34, spanHz: 106, gears: 5, gearTop: 31,
    sub: 0.5, saw: 0.24, square: 0.11,
    cutoffHz: 400, cutoffSpan: 1520, level: 0.23,
  },

  // Four-cylinder diesel: dark, low-revving and audibly rough. The square is
  // pushed hard for clatter and then the filter is closed down over it, which
  // is what separates diesel roughness from petrol brightness.
  singlecab: {
    idleHz: 25, spanHz: 74, gears: 5, gearTop: 26,
    sub: 0.42, saw: 0.3, square: 0.19,
    cutoffHz: 250, cutoffSpan: 980, level: 0.24,
  },

  // Short-wheelbase petrol with no roof to muffle it: lighter, brighter and
  // happier to rev than the wagon it is built on.
  softtop: {
    idleHz: 44, spanHz: 142, gears: 5, gearTop: 34,
    sub: 0.4, saw: 0.28, square: 0.09,
    cutoffHz: 460, cutoffSpan: 1760, level: 0.21,
  },

  // A single-cylinder thumper. Highest and thinnest here by a distance: the
  // fundamental leads, the sub nearly disappears, and six short gears to 43 m/s
  // means it is shifting constantly where the pickup is still in third.
  moto: {
    idleHz: 64, spanHz: 246, gears: 6, gearTop: 43,
    sub: 0.26, saw: 0.36, square: 0.17,
    cutoffHz: 720, cutoffSpan: 2800, level: 0.185,
  },

  // Tube frame, no bodywork, nothing between the engine and your ears. Raspy
  // rather than loud — the saw leads and the filter sits wide open.
  buggy: {
    idleHz: 53, spanHz: 206, gears: 4, gearTop: 39,
    sub: 0.29, saw: 0.4, square: 0.14,
    cutoffHz: 620, cutoffSpan: 2480, level: 0.2,
  },
};
