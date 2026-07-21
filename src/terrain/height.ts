/**
 * The world's height and surface fields.
 *
 * Everything here is deterministic and side-effect free so the physics
 * heightfields, the render chunks and the traction model all read the exact
 * same ground. Real dunes are asymmetric — a long gentle windward ramp and a
 * short slip face at the ~32° angle of repose — and that asymmetry is the whole
 * reason dune bashing has a skill to it (you read which side you're on before
 * you commit). A symmetric sine field would feel like corrugated iron.
 */

import { POIS, type PoiKind } from '../data/pois';

/** The curated region at the heart of the endless dune field. ~4.2 km². */
export const WORLD_SIZE = 2048;
export const WORLD_HALF = WORLD_SIZE / 2;

// --- deterministic value noise ------------------------------------------------

/**
 * 32-bit integer hash -> [0, 1).
 *
 * `Math.imul` is load-bearing, not a micro-optimisation. Plain `*` evaluates in
 * float64, and these constants push the product past 2^53, so the low bits — the
 * entire point of a hash — are silently rounded away. The naive version of this
 * function returned [0, 0.5] with a mean of 0.25 rather than a mean of 0.5,
 * which quietly starved every `smoothstep` window downstream and flattened the
 * whole world. Shifts are unsigned so the sign bit participates.
 */
export function hash2(ix: number, iz: number): number {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function valueNoise(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return (a * (1 - ux) + b * ux) * (1 - uz) + (c * (1 - ux) + d * ux) * uz;
}

function fbm(x: number, z: number, octaves: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let fx = x;
  let fz = z;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(fx, fz) * amp;
    norm += amp;
    amp *= 0.5;
    fx *= 2.03;
    fz *= 1.97;
  }
  return sum / norm;
}

function fract(x: number): number {
  return x - Math.floor(x);
}

/**
 * fbm remapped to actually span 0..1.
 *
 * Raw value-noise fbm is an average of bilinearly interpolated uniforms, so it
 * clusters hard around 0.5 — in practice it barely leaves 0.35..0.65. Gating a
 * feature on `smoothstep(0.2, 0.8, fbm(...))` therefore returns ~0.5 almost
 * everywhere, and every feature it controls comes out uniformly mid-strength
 * with no variety. `spread` is the half-width of the band that gets stretched
 * across the full range.
 */
function fbmRange(x: number, z: number, octaves: number, spread = 0.12): number {
  return smoothstep(0.5 - spread, 0.5 + spread, fbm(x, z, octaves));
}

// --- dune profile -------------------------------------------------------------

/** Crest sits at 72% of the wavelength: long windward ramp, short slip face. */
const CREST = 0.72;

function duneProfile(p: number): number {
  if (p < CREST) {
    const t = p / CREST;
    return t * t * (3 - 2 * t);
  }
  const t = (p - CREST) / (1 - CREST);
  return 1 - t * t * (3 - 2 * t);
}

// Prevailing wind for the primary dune train.
const WIND = 0.55;
const WIND_X = Math.cos(WIND);
const WIND_Z = Math.sin(WIND);
const WAVELENGTH = 165;

/**
 * Position within the dune train at this point.
 *
 * `p` is the phase 0..1 through one dune (0 at the trough, CREST at the brink),
 * `v` runs along the crest line. Shared by the height and softness fields on
 * purpose: softness keys off which *face* of the dune you're on, so if these
 * two ever computed the phase differently the loose sand would drift off the
 * slip faces it's supposed to mark.
 */
function dunePhase(x: number, z: number): { p: number; v: number } {
  const u = x * WIND_X + z * WIND_Z;
  const v = -x * WIND_Z + z * WIND_X;
  const wander = (fbm(u * 0.0035, v * 0.0022, 2) - 0.5) * 110;
  return { p: fract((u + wander) / WAVELENGTH), v };
}

/** Additive sculpted feature: an oriented elliptical ridge. */
function ridgeBump(
  x: number, z: number,
  cx: number, cz: number,
  angle: number,
  lengthR: number, widthR: number,
  height: number,
): number {
  const dx = x - cx;
  const dz = z - cz;
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const u = (dx * ca + dz * sa) / lengthR;
  const v = (-dx * sa + dz * ca) / widthR;
  const d = Math.sqrt(u * u + v * v);
  if (d >= 1) return 0;
  return height * (1 - d * d) * (1 - d * d);
}

/**
 * How built-up the dune field is at this point, 0..1.
 * Low values are sabkha — flat salt-pan floors between dune fields. Having
 * genuinely open ground matters: unbroken dunes horizon-to-horizon reads as
 * noise, and the flats are where the world gets to breathe.
 *
 * Frequency is chosen against WORLD_SIZE: the value noise lattice is on integer
 * units, so `freq * WORLD_SIZE` is literally how many cells of variation exist
 * across the whole map. Too low and the fbm is a constant everywhere — which,
 * once clamped by the smoothstep below, silently flattens the entire world.
 * 0.0034 gives ~7 cells, so fields turn over roughly every 300m.
 */
export function duneFieldMask(x: number, z: number): number {
  // Floored well above zero: sabkha should be a place you come across, never
  // the default state of the map.
  return 0.24 + 0.76 * fbmRange(x * 0.0034 + 11, z * 0.0034 - 7, 3, 0.1);
}

/** The dune field alone, before POI pads. Pad targets are sampled from this. */
function rawHeightAt(x: number, z: number): number {
  const field = duneFieldMask(x, z);

  // Broad rolling ground everything else sits on, turning over every ~400m.
  const swell = fbm(x * 0.0025, z * 0.0025, 3) * 24;

  // Ridge-aligned coordinates: u runs downwind, v runs along the crest.
  const u = x * WIND_X + z * WIND_Z;
  const { p, v } = dunePhase(x, z);

  // Amplitude varies within a field too, so crest heights aren't uniform.
  const local = fbmRange(u * 0.0045, v * 0.0055, 3, 0.12);
  // Capped against the wavelength: the slip face is 28% of WAVELENGTH, so an
  // amplitude much past ~30m puts it well beyond sand's ~32° angle of repose.
  // Real dunes can't hold that, and an unclimbable wall isn't relaxing.
  const amp = (8 + 26 * local) * field;

  let h = swell + duneProfile(p) * amp;

  // A second, finer dune train running across the primary one. Real ergs are
  // rarely a single direction, and the interference makes bowls worth exploring.
  const u2 = x * Math.cos(WIND + 1.35) + z * Math.sin(WIND + 1.35);
  const p2 = fract(u2 / 71 + fbm(x * 0.004, z * 0.004, 2) * 0.6);
  h += duneProfile(p2) * 5.5 * field * local;

  // Tyre-scale ripples.
  h += Math.sin(v * 0.09) * 0.5 * field;

  // --- hand-sculpted landmarks -----------------------------------------------
  // A big steep-faced dune: the momentum-climb proving ground.
  h += ridgeBump(x, z, 470, -260, 0.4, 150, 92, 44);
  // A long sidehill traverse: rollover tension without a cliff at the end.
  h += ridgeBump(x, z, -430, 300, 1.9, 250, 66, 30);
  // A short sharp kicker for airtime and landing compression.
  h += ridgeBump(x, z, -150, -520, 0.2, 80, 44, 18);
  // A broad high ridge to give the horizon something to do.
  h += ridgeBump(x, z, 120, 760, 2.5, 420, 150, 52);

  // A small firm pan at spawn keeps baseline handling judgeable on the flat,
  // but it stays tight — a wide featureless apron is a poor first impression of
  // a world that's supposed to read as dunes.
  h *= smoothstep(18, 75, Math.hypot(x, z));

  // No rim wall: the dune field runs on procedurally in every direction so the
  // horizon reads as endless. The curated region is bounded instead by a soft
  // fade-and-respawn once you drive well past the points of interest (see
  // WorldBoundary), which never tells you "no" or drops you into a void.
  return h;
}

// --- POI ground pads ----------------------------------------------------------

/**
 * Each built landmark stands on a graded pad: inside the inner ellipse the
 * ground *is* the pad height, and a blend ring eases it back into the dunes.
 * This is what actually fits the POIs to the landscape — structures need flat
 * ground under their whole footprint, and faking it by bending the props to the
 * dunes tears multi-piece models apart. Physics heightfields, render chunks and
 * landmark colliders all read the padded field, so they can't disagree.
 *
 * Footprints live here rather than in pois.ts because they're a property of the
 * built geometry (how wide the majlis ring is), not of the narrative trigger.
 * The famous dune has no pad on purpose: its tripods are freestanding dressing
 * on a hand-sculpted dune that should stay a dune.
 */
interface Pad {
  x: number;
  z: number;
  ca: number;
  sa: number;
  lengthR: number;
  widthR: number;
  /** Cheap axis-aligned reject radius covering the whole blend ellipse. */
  bound: number;
  /** Grade height, sampled lazily from the raw field at the pad centre. */
  target: number;
}

/** The blend ring extends the inner ellipse by this factor. */
const PAD_BLEND = 1.6;

const PAD_FOOTPRINTS: Partial<Record<PoiKind, { lengthR: number; widthR: number; angle: number }>> = {
  falaj: { lengthR: 14, widthR: 5, angle: 0.5 },
  ghaf: { lengthR: 5, widthR: 5, angle: 0 },
  watchtower: { lengthR: 8, widthR: 8, angle: 0 },
  majlis: { lengthR: 7, widthR: 7, angle: 0 },
  pylons: { lengthR: 5, widthR: 5, angle: 0 },
  teastand: { lengthR: 4.5, widthR: 4.5, angle: 0 },
  falconry: { lengthR: 7, widthR: 5, angle: 0 },
  cameltrack: { lengthR: 42, widthR: 8, angle: 0 },
  coffeehearth: { lengthR: 3, widthR: 3, angle: 0 },
};

const PADS: Pad[] = POIS.flatMap((poi) => {
  const spec = PAD_FOOTPRINTS[poi.id];
  if (!spec) return [];
  return [{
    x: poi.x,
    z: poi.z,
    ca: Math.cos(spec.angle),
    sa: Math.sin(spec.angle),
    lengthR: spec.lengthR,
    widthR: spec.widthR,
    bound: Math.max(spec.lengthR, spec.widthR) * PAD_BLEND,
    target: Number.NaN,
  }];
});

export function heightAt(x: number, z: number): number {
  let h = rawHeightAt(x, z);
  for (const pad of PADS) {
    const dx = x - pad.x;
    if (dx > pad.bound || dx < -pad.bound) continue;
    const dz = z - pad.z;
    if (dz > pad.bound || dz < -pad.bound) continue;
    const u = (dx * pad.ca + dz * pad.sa) / pad.lengthR;
    const v = (-dx * pad.sa + dz * pad.ca) / pad.widthR;
    const d = Math.sqrt(u * u + v * v);
    if (d >= PAD_BLEND) continue;
    // Lazy: the target needs the raw field, which isn't callable at module init.
    if (Number.isNaN(pad.target)) pad.target = rawHeightAt(pad.x, pad.z);
    h += (pad.target - h) * (1 - smoothstep(1, PAD_BLEND, d));
  }
  return h;
}

/**
 * Sand softness 0..1 (0 = hardpack gravel, 1 = deep loose sand).
 * Drives traction, sink drag and climb bleed in the tyre model (§2).
 */
export function softnessAt(x: number, z: number): number {
  const base = fbm(x * 0.0035 + 40, z * 0.0035 - 25, 3);

  // Windward faces get packed hard by the wind; lee/slip faces stay loose.
  const { p } = dunePhase(x, z);
  const lee = smoothstep(CREST - 0.08, CREST + 0.12, p);

  // Sabkha floors are crusted salt pan, not sand — firm and fast.
  const field = duneFieldMask(x, z);

  let s = clamp01(0.2 + base * 0.55 + lee * 0.4) * (0.35 + 0.65 * field);
  // Spawn pan is hardpack: a stable reference surface for tuning.
  s *= smoothstep(16, 70, Math.hypot(x, z));
  return clamp01(s);
}
