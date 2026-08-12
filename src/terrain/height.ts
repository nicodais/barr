/**
 * The world's height and surface fields.
 *
 * Everything here is deterministic and side-effect free so the physics
 * heightfields, the render chunks and the traction model all read the exact
 * same ground.
 *
 * ## The region
 *
 * This is not "a desert" — it's **Liwa**, on the northern edge of the Rub' al
 * Khali in Al Dhafra, and specifically the ground around **Tal Moreeb**. Four
 * things about that place drive everything below:
 *
 *  - There is **one landmark and it dominates**. The great dune is visible from
 *    everywhere and the region is oriented around it (see MOREEB). Every other
 *    feature here is scenery by comparison, which is the honest relationship.
 *  - The sand is **red**. Inland Emirati dune sand is quartz with an iron-oxide
 *    coating on the grains, and the finer, more heavily stained grains get blown
 *    up onto the crests — so ridges run red-orange while the coarser, paler
 *    interdune floors stay grey-buff. That's a grain-sorting fact, and it's
 *    modelled as one (see `surfaceAt`) rather than painted on.
 *  - The dunes are **big and layered**. The shamal blows out of the north-west,
 *    and Liwa's dune trains ride on compound ridges (draa) far larger than
 *    anything in the Emirates' northern deserts. A single dune scale reads as
 *    corrugated iron; the hierarchy is what makes a ridgeline read as landscape.
 *  - There is **no rock**. This is deep sand sea — the only ground that isn't
 *    dune is the sabkha and salt-pan floor in the interdune corridors. An
 *    outcrop here would be the one thing that reads as wrong, which is why the
 *    limestone cuestas this file used to carry are gone.
 *
 * ## Slopes are governed, not guessed
 *
 * Sand cannot stand steeper than its angle of repose — about 33°. Past that it
 * avalanches, which is why every real slip face in the world sits at the same
 * angle. The old field enforced this by capping dune amplitude against a fixed
 * wavelength, which is the wrong lever: it made every big dune the same height
 * and still didn't guarantee the slope. Here the *slip face length* is solved
 * from the amplitude instead (`duneSample`), so a taller dune simply gets a
 * longer face and the angle comes out right by construction. Reading which face
 * you're on and carrying momentum into the climb is the whole skill of dune
 * bashing (§2), and it only exists if the geometry is honest about repose.
 */

import { activeRegion } from './regions';
import type { GreatDuneSpec, MassifSpec, RegionSpec } from './regions';

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

// --- regional orientation -----------------------------------------------------

/**
 * Dune trend for the region.
 *
 * `+Z` is north and `+X` is east — that's Compass's convention
 * (`atan2(forward.x, forward.z)`), and the POI bearings assume it too. Liwa's
 * megadune trains run roughly WNW–ESE under the shamal, so crest lines sit near
 * a bearing of 105° and the sand transport axis is perpendicular, close to 15°.
 *
 * Every downwind measurement in this file is along `u` and every along-crest one
 * is along `v`, so re-aiming the whole dune field is these two numbers and
 * nothing else.
 */
/**
 * Live bindings, not constants. ES module exports are references, so a consumer
 * that imported WIND_X at load still sees the new value after a region swap —
 * which is what lets the crest plumes and the sand shader stay correct without
 * either of them knowing regions exist.
 */
export let WIND_X = 1;
export let WIND_Z = 0;

/**
 * Everything the field needs that is derived from the region rather than stored
 * on it. Recomputed once per swap instead of per sample: `heightAt` runs a few
 * hundred thousand times per chunk and these are all trigonometry.
 */
interface Derived {
  region: RegionSpec;
  greatDune: GreatDuneSpec | null;
  gdCa: number;
  gdSa: number;
  massif: MassifSpec | null;
  mCa: number;
  mSa: number;
  pads: Pad[];
}

let D: Derived;

/**
 * Rebuilds every cached quantity for the region that is currently active.
 *
 * Called from `setRegion` and once at module load. Everything downstream of the
 * height field — chunks, colliders, landmarks, scatter, baked tracks — is stale
 * after this and has to be torn down by the caller.
 */
export function refreshRegion() {
  const region = activeRegion();
  WIND_X = Math.cos(region.crestBearing);
  WIND_Z = -Math.sin(region.crestBearing);
  D = {
    region,
    greatDune: region.greatDune,
    gdCa: region.greatDune ? Math.cos(region.greatDune.bearing) : 1,
    gdSa: region.greatDune ? Math.sin(region.greatDune.bearing) : 0,
    massif: region.massif,
    mCa: region.massif ? Math.cos(region.massif.bearing) : 1,
    mSa: region.massif ? Math.sin(region.massif.bearing) : 0,
    pads: buildPads(region),
  };
}

/** Where the region's hero landform sits, for the compass and the POI to agree. */
export function heroPoint(): { x: number; z: number } | null {
  if (D.greatDune) return { x: D.greatDune.x, z: D.greatDune.z };
  if (D.massif) return { x: D.massif.x, z: D.massif.z };
  return null;
}

/** Downwind distance. Dunes advance along this axis; slip faces face +u. */
export function alongWind(x: number, z: number): number {
  return x * WIND_X + z * WIND_Z;
}

/** Along-crest distance. Ridges are continuous along this axis. */
export function alongCrest(x: number, z: number): number {
  return -x * WIND_Z + z * WIND_X;
}

// --- slope budget -------------------------------------------------------------

/** Angle of repose for dry dune sand. The one number the slip faces obey. */
const TAN_REPOSE = Math.tan((33 * Math.PI) / 180);
/**
 * Steepest windward ramp we'll build. Real windward faces run 10–15°; this is
 * deliberately past that, because a ramp you can climb flat-out isn't a climb.
 */
const TAN_WINDWARD = Math.tan((20 * Math.PI) / 180);
/**
 * A smoothstep's peak gradient is 1.5x its average (d/dt of t²(3-2t) is 6t(1-t),
 * maximised at t=0.5). Both dune faces are smoothsteps, so every "how long must
 * this face be" calculation carries this factor.
 */
const PROFILE_PEAK = 1.5;
/**
 * Slope headroom held back for everything the repose solver doesn't model.
 *
 * The obvious residuals are the regional swell, the third dune scale and the
 * ripple term. The one that actually mattered is less obvious: *every field
 * that scales a dune contributes its own gradient*. A mask running 0.24 to 1.0
 * over 50 m of ground, multiplying a 46 m ridge, is a 60° wall all by itself —
 * no dune involved. That is what the first sampling run of this field found, and
 * it's why the masks and amplitude fields below are all deliberately slow: a
 * field that scales a landform has to vary over a longer distance than the
 * landform is wide, or it *is* the landform.
 *
 * Tuned against the sampler rather than derived: a strict worst-case bound on
 * the sum of the residuals is roughly 3x what any of them reach in practice, and
 * budgeting for it would flatten the whole map to be safe from a case that never
 * happens. Every 0.06 of reserve costs about a degree off the steepest faces in
 * the region, so this is not a free "just make it bigger" knob — sampling the
 * curated region at the physics resolution gives, for sand away from rock:
 *
 *     reserve   p50    p90    p99    p99.9   max     over 33°
 *     0.16      7.1    19.2   28.3   31.6    34.7    0.02%
 *     0.10      7.0    19.4   29.6   33.5    35.4    0.18%
 *     0.06      7.0    19.4   30.7   35.0    36.6    0.37%
 *
 * 0.10 is the value where the steepest tenth of a percent of the sand sits at
 * the angle of repose, which is exactly the physical claim this file is making.
 */
const SLOPE_RESERVE = 0.12;

// --- the dune field -----------------------------------------------------------

// Wavelengths are per-region now (see regions.ts) — Liwa is a sand sea at 165m
// and 810m, Fossil Rock a tighter dune field at 118m and 520m.

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
 * 0.0018 gives ~4 cells, so fields turn over roughly every 550m.
 *
 * The wide `spread` is a slope decision, not an aesthetic one — see
 * SLOPE_RESERVE. A tight remap here puts a cliff at every field boundary.
 */
export function duneFieldMask(x: number, z: number): number {
  const r = D.region;
  // Floored well above zero: sabkha should be a place you come across, never
  // the default state of the map.
  //
  // The offsets are curation, not decoration. They decide what the player is
  // looking at on the opening frame, and the previous pair sat spawn in the
  // middle of a 200 m salt flat — so the first thing the game showed of a
  // region defined by its red sand was a pale grey pan. These put the dune
  // field within 120 m in most directions while keeping about a third of the
  // map open, and they keep the mask low enough at the origin that the spawn
  // scrape below doesn't have to cut a crater to make its flat.
  return r.fieldFloor + (1 - r.fieldFloor) * fbmRange(
    x * r.fieldFreq + r.fieldOffsetX,
    z * r.fieldFreq + r.fieldOffsetZ,
    3,
    r.fieldSpread,
  );
}

/**
 * The same idea one scale up, for the draa.
 *
 * A separate, much slower mask rather than reusing `duneFieldMask`: the ridges
 * it scales are 46 m tall and hundreds of metres wide, so a mask that turns over
 * every 550 m would carve their flanks off. It also floors much higher, because
 * the compound ridges are the region's underlying grain — they run *under* the
 * sabkha flats rather than stopping at them.
 */
function draaMask(x: number, z: number): number {
  return 0.55 + 0.45 * fbmRange(x * 0.0008 - 27, z * 0.0008 + 53, 2, 0.3);
}

interface Megadune {
  /** Height contribution, metres. */
  h: number;
  /** d(h)/du — signed, and the reason the slip faces below stay legal. */
  slope: number;
  /** 0 in the corridor between ridges, 1 on the ridge crest. */
  top: number;
}

/**
 * The draa scale: long compound ridges the dune train rides on.
 *
 * Deliberately gentle — a raised cosine tops out at `amp * PI / wavelength`,
 * about 12° here. That's correct as well as convenient: on a real compound dune
 * the big ridge is a broad swell and the steep faces all belong to the smaller
 * dunes superimposed on it. Handing the draa a slip face of its own would eat
 * the entire repose budget and leave the dune train nothing to work with.
 */
function megaduneAt(u: number, v: number, mask: number): Megadune {
  // Kept slow and modest: this shifts the phase, so its derivative multiplies
  // the ridge's apparent steepness and is charged against SLOPE_RESERVE.
  const wander = (fbm(u * 0.0006 + 61, v * 0.0004 - 19, 2) - 0.5) * 90;
  const mega = D.region.megaWavelength;
  const phase = 2 * Math.PI * fract((u + wander) / mega);
  const along = fbmRange(u * 0.0007 - 5, v * 0.0009 + 3, 2, 0.3);
  const amp = (20 + 30 * along) * mask;
  const top = 0.5 - 0.5 * Math.cos(phase);
  return {
    h: amp * top,
    slope: (amp * Math.PI * Math.sin(phase)) / mega,
    top,
  };
}

interface DuneSample {
  u: number;
  v: number;
  /** Phase 0..1 through one dune: 0 at the upwind trough, `crest` at the brink. */
  p: number;
  /** Where the brink sits in that phase. Varies per point — see below. */
  crest: number;
  amp: number;
  /** 0 in the trough, 1 at the brink. Doubles as "how exposed is this sand". */
  profile: number;
  mega: Megadune;
  field: number;
}

/**
 * Everything about the dune train at one point.
 *
 * Height, softness and surface colour all read this, and they must read the
 * *same* one: softness keys off which face of the dune you're on, so if the two
 * ever disagreed about where the brink was, the loose sand would drift off the
 * slip faces it's supposed to mark.
 *
 * The interesting part is the last third. Amplitude is *wanted* from noise, but
 * what the ground can actually hold is decided by the slope budget: the slip
 * face needs `PROFILE_PEAK * amp / leeSlope` metres of run to descend at repose,
 * the windward ramp needs `PROFILE_PEAK * amp / TAN_WINDWARD` to climb at a
 * sane angle, and the two together have to fit inside one wavelength. Solving
 * that for `amp` gives the tallest dune this spot can carry; anything the noise
 * asks for beyond it is refused. It's the same arithmetic an avalanche does,
 * done once in closed form instead of iteratively over a grid.
 */
function duneSample(x: number, z: number): DuneSample {
  const u = alongWind(x, z);
  const v = alongCrest(x, z);
  const field = duneFieldMask(x, z);
  const mega = megaduneAt(u, v, draaMask(x, z));

  // Sinuosity of the crest lines. Bounded well below 1: this is a phase shift
  // per metre of `u`, so at 1.0 the dune train folds back through itself.
  const wander = (fbm(u * 0.0022, v * 0.0014, 2) - 0.5) * 45;
  const wavelength = D.region.wavelength;
  const p = fract((u + wander) / wavelength);

  const local = fbmRange(u * 0.0018, v * 0.0016, 2, 0.24);
  // Superimposed dunes grow toward the top of the draa they sit on — the flanks
  // are swept, the crest accumulates.
  const wanted = (6 + 15 * local) * field * (0.5 + 0.6 * mega.top);

  // The draa's own descent eats into the budget where it falls away downwind,
  // which is exactly where a slip face would otherwise stack on top of it.
  const leeSlope = Math.max(0.18, TAN_REPOSE - Math.max(0, -mega.slope) - SLOPE_RESERVE);
  const maxAmp = wavelength / (PROFILE_PEAK * (1 / TAN_WINDWARD + 1 / leeSlope));
  const amp = Math.min(wanted, maxAmp);

  const crest = 1 - (PROFILE_PEAK * amp) / leeSlope / wavelength;
  const profile = duneProfile(p, crest);

  return { u, v, p, crest, amp, profile, mega, field };
}

/** Long windward ramp up to `crest`, short slip face down from it. */
function duneProfile(p: number, crest: number): number {
  if (p < crest) {
    const t = p / crest;
    return t * t * (3 - 2 * t);
  }
  const t = (p - crest) / (1 - crest);
  return 1 - t * t * (3 - 2 * t);
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
// --- the great dune -----------------------------------------------------------

/**
 * Tal Moreeb — the one landmark this region is built around.
 *
 * ## Compressed, and honest about it
 *
 * The real dune is roughly 1.6 km long and rises somewhere between 100 m and
 * 300 m depending where you call the base. The curated region is about 1.5 km
 * across, so at true scale the great dune would be *larger than the entire
 * playable area* — you would spawn on it and never find its edges. This is
 * built at about 120 m over a 640 m crest instead: still more than twice
 * anything else in the world, still visible from every corner of the region,
 * and still a climb that takes commitment, but with room left over for a
 * desert to exist around it.
 *
 * ## The climb face is the point
 *
 * Moreeb is famous because people race up it. The Liwa festival runs hill
 * climbs straight at the steep face, and that is the interaction worth having
 * here: pick your line, carry everything you have into it, and find out how far
 * up you get. So the dune is deliberately asymmetric in a way the procedural
 * field never is —
 *
 *  - **The south-west face is the climb.** Long, straight, unbroken and pitched
 *    just inside what a truck can actually take with a run-up. It is the only
 *    slope in the region tuned to be *nearly* too steep.
 *  - **The north-east face is a slip face** at the angle of repose, which is
 *    what the sand does when it is left alone.
 *
 * Like the sculpted set pieces it sits among, this is exempt from the repose
 * solver — the solver governs the procedural field, and a hand-placed landmark
 * that the whole map is named for gets to be its own shape. What it does obey
 * is drivability, which was measured rather than guessed (see MOREEB).
 */
// Tal Moreeb's dimensions live in regions.ts now. The two that were solved
// rather than picked, and that any future great dune has to respect:
//
//  - `climbRun` is solved backwards from the angle. The profile below is
//    steepest at its foot at 1.5x the mean grade, so a 35 degree worst case
//    over a 120m rise needs 1.5 * 120 / tan(35) = 257m of run, plus the crown.
//    Past repose on purpose: the appeal of the real dune is that it is steeper
//    than sand has any business being.
//  - `slipRun` is at repose like every other slip face here, 1.5 * 120 /
//    tan(33) = 277m. It is *longer* than the climb face, which looks wrong
//    written down and is right — repose is the shallower angle.

/**
 * Height added by the great dune, and how much of it is here at all.
 *
 * The `presence` term is returned alongside the height because the surface
 * model needs it: sand this steep and this exposed is scoured and re-sorted
 * constantly, so the dune's own faces read differently from the field around
 * them, and the colour has to know where the dune is without re-deriving it.
 */
function moreebAt(x: number, z: number): { h: number; presence: number } {
  const M = D.greatDune;
  if (!M) return { h: 0, presence: 0 };
  const dx = x - M.x;
  const dz = z - M.z;
  // s runs along the crest, v across it: negative into the climb face,
  // positive out over the slip face.
  const s = dx * D.gdCa + dz * D.gdSa;
  const v = -dx * D.gdSa + dz * D.gdCa;

  if (v < -M.climbRun || v > M.slipRun) return { h: 0, presence: 0 };

  // Along the crest: full height across the middle, falling away to squared-off
  // shoulders rather than a point. A dune this size ends in a nose, not a tip.
  //
  // The taper fraction is a slope, not a styling choice, and it was the single
  // steepest thing in the region before it was solved for. At 0.34 the nose
  // shed the full 120 m over 109 m of crest — a 48° flank on the *ends* of the
  // dune, steeper than either of its actual faces, and invisible in the stats
  // because so little of the dune is "present" out there that it reads as
  // field. 0.54 spreads the same drop over 173 m and brings it to 35°.
  const along = clamp01((1 - Math.abs(s) / M.crestR) / M.taper);
  if (along <= 0) return { h: 0, presence: 0 };

  let profile: number;
  if (v <= -M.crown) {
    // The climb: steepest at the foot, easing toward the crest.
    //
    // That direction is the whole design. A smoothstep — or anything with an
    // exponent above 1 — is shallow at the bottom and steepens in the middle or
    // at the top, which puts the hardest metres exactly where the truck has
    // already spent its momentum; you get the same failure every run with no
    // way to read it coming. Front-loading the grade means the decision is made
    // at the bottom, where the player can still act on it: commit or don't.
    // `1-(1-t)^1.5` has a gradient of exactly 1.5x the mean at t=0 and falls
    // monotonically from there, which is why the run above could be solved from
    // an angle. Getting this exponent wrong is expensive and quiet: the first
    // attempt used a cubic falloff whose gradient at the foot is 3.5x the mean,
    // so the bottom of the climb was a 58° wall — the steepest thing in the
    // region, sitting exactly where the player is meant to commit.
    const t = clamp01((v + M.climbRun) / (M.climbRun - M.crown));
    profile = 1 - Math.pow(1 - t, 1.5);
  } else if (v <= 0) {
    profile = 1;
  } else {
    // Slip face: smoothstep down, so it breaks over the brink rather than
    // starting at full pitch the way the climb face does.
    const t = clamp01(v / M.slipRun);
    profile = 1 - t * t * (3 - 2 * t);
  }

  const presence = along * profile;
  return { h: M.height * presence, presence };
}

// --- the limestone massif -----------------------------------------------------

/**
 * Jebel Maleihah, for the regions that have rock in them.
 *
 * The first attempt at rock in this project was a faceted, bench-stepped cuesta
 * and it failed in two specific ways that this shape is built to avoid:
 *
 *  - **Plan-view faceting moved the crest line between facets**, so the
 *    "drivable" ramp had a 13m vertical wall across it every 33m. The footprint
 *    here is a smooth ellipse evaluated per sample; there are no facets to
 *    disagree with each other.
 *  - **Bedding benches were quantised with `round()`**, which is discontinuous,
 *    so every bench edge was a wall. There are no benches. The profile is one
 *    continuous curve, and the rock reads as rock through colour and the fact
 *    that it is far too steep to be sand — not through stair-stepping.
 *
 * The other lesson kept: the rock surface is `max`-ed against the dune field
 * rather than replacing it or sitting on a skirt at its own datum. A horizontal
 * skirt plane put 10m steps into every hollow it crossed. Taking the maximum
 * means sand banks up against the rock exactly where the sand is higher, which
 * is also what actually happens out there.
 */
function massifAt(x: number, z: number): { h: number; rock: number } {
  const M = D.massif;
  if (!M) return { h: 0, rock: 0 };
  const dx = x - M.x;
  const dz = z - M.z;
  const along = dx * D.mCa + dz * D.mSa;
  const across = -dx * D.mSa + dz * D.mCa;

  // Normalised distance out from the ridge line. The two sides get different
  // reaches: a short one is a scarp, a long one is a talus ramp.
  const side = across >= 0 ? M.flare : M.flare * M.scarp;
  const u = along / M.lengthR;
  const v = across / (M.widthR * side);
  const d = Math.hypot(u, v);
  if (d >= 1) return { h: 0, rock: 0 };

  // Flat-topped along the ridge and across it. The along-ridge term was a
  // raised cosine, which tapers both ends to a cone — so from any angle off the
  // long axis the massif read as a smooth grey dome rather than as a jebel. A
  // power curve holds the crest at full height for most of its length and then
  // drops it, which is how a limestone ridge actually ends: in a nose.
  const ridge = 1 - Math.pow(clamp01(Math.abs(u)), 3.2);
  const onRamp = across >= 0;
  const power = onRamp ? M.rampPower : M.scarpPower;
  const flank = 1 - Math.pow(clamp01(Math.abs(v)), power);
  const relief = ridge * flank;

  // Broken rock rather than a machined surface, and *ridged* noise rather than
  // plain fbm: `1 - |2n-1|` has creases where ordinary noise has smooth minima,
  // which is the difference between a grey hill and something made of stone.
  //
  // Held right down on the ramp side. This is the only way up the massif, and
  // the first pass at roughness put a 28m-period, 4.5m-amplitude field over the
  // whole thing — 27 degrees of gradient on its own, on top of a 21 degree
  // climb. The scarp can afford all the relief it likes because nobody is
  // driving up a 67 degree cliff.
  const n = fbm(x * 0.022 + 11, z * 0.022 - 7, 3);
  const ridged = 1 - Math.abs(2 * n - 1);
  const roughAmp = onRamp ? 1.1 : 4.2;
  const rough = (ridged - 0.5) * roughAmp * relief;

  const h = M.height * relief + rough;
  // How much of the surface here is bare rock, for the palette. Rises fast off
  // the toe so the sand/rock boundary is a line rather than a gradient — that
  // contrast is the whole reason the massif is in the world.
  return { h, rock: clamp01((relief - 0.06) * 7) };
}

/**
 * Bare rock fraction at a point, 0..1. Read by the terrain colour and by the
 * surface model, since stone is the firmest ground in the game.
 *
 * The ellipse reject inside `massifAt` returns before anything expensive
 * happens, so away from the jebel this costs two multiplies — which matters,
 * because `surfaceAt` calls it and the tyre model calls that four times per
 * physics step.
 */
export function rockAt(x: number, z: number): number {
  if (!D.massif) return 0;
  const m = massifAt(x, z);
  if (m.rock <= 0) return 0;
  // Only rock where the rock is actually the surface. Sand banked higher than
  // the stone wins, which is what puts the dune ramp up the massif's flank.
  return m.h >= duneGroundAt(x, z) ? m.rock : 0;
}

// --- assembly -----------------------------------------------------------------

/** The procedural dune field, before the great dune is added on top of it. */
function duneGroundAt(x: number, z: number): number {
  const s = duneSample(x, z);

  // Broad regional swell everything else sits on. Kept low-amplitude: with the
  // draa scale doing the heavy lifting now, this is only here to stop the
  // interdune floors from being level with each other.
  let h = fbm(x * 0.002 + 3, z * 0.002 - 9, 3) * D.region.swell;

  h += s.mega.h;

  // --- hand-sculpted set pieces ----------------------------------------------
  // Summed first, because the dune train gets suppressed under them: a set piece
  // has to be one legible landform, and stacking a full-amplitude dune train on
  // a 44 m sculpted dune both muddles its silhouette and lands the sum of two
  // slip faces well past anything sand can hold.
  //
  // Widths are set from the slope these produce: `(1-d²)²` peaks at 1.54/radius,
  // so the width radius is what decides the face angle, and each of these is
  // sized to come out at or just under repose on its own.
  // No sculpted hero dune: the region's hero is its great dune or its massif,
  // and a 44 m lump 200 m off the flank of either reads as a spare hill nobody
  // had a use for. What's left are traverses, kickers and horizon ridges, and
  // they live in the region spec because they are the part of the landscape
  // that is authored rather than generated.
  let sculpted = 0;
  for (const b of D.region.sculpted) {
    sculpted += ridgeBump(x, z, b.x, b.z, b.angle, b.lengthR, b.widthR, b.height);
  }
  const sculptedWeight = clamp01(sculpted / 18);

  h += s.profile * s.amp * (1 - 0.8 * sculptedWeight);

  // A third, finer scale riding on the flanks — real ergs are never one
  // wavelength, and the interference is what makes bowls worth exploring.
  //
  // Symmetric rather than slip-faced, unlike the two scales above. A raised
  // cosine tops out at `amp * PI / wavelength`, which is a slope this can be
  // charged for; giving it a proper brink instead would put another 0.34 of
  // gradient on top of a face that is already at the angle of repose.
  const u3 = alongWind(x, z) * 0.97 + alongCrest(x, z) * 0.24;
  const p3 = fract(u3 / 58 + fbm(x * 0.004, z * 0.004, 2) * 0.6);
  h += (0.5 - 0.5 * Math.cos(2 * Math.PI * p3)) * 3 * s.field * s.mega.top
    * (1 - sculptedWeight);

  // Wind ripples, running across the wind like real ones do — so they vary
  // along `u` and their little crests lie parallel to the dune's. The chunk grid
  // samples every 2 m and real ripples are 10–20 cm apart, so this is a stand-in
  // for their *shading*, not their geometry; it can only ever be a suggestion at
  // this resolution.
  h += Math.sin(s.u * 0.11) * 0.35 * s.field;

  h += sculpted;

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

/** The full landscape, before POI pads. Pad targets are sampled from this. */
function rawHeightAt(x: number, z: number): number {
  const ground = duneGroundAt(x, z) + moreebAt(x, z).h;
  // Rock is a maximum, not a sum — see massifAt. Sand piles against the jebel;
  // it does not lift it.
  return D.massif ? Math.max(ground, massifAt(x, z).h) : ground;
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
  /** Normalised distance at which the blend ring ends. */
  blend: number;
  /** Grade height, sampled lazily from the raw field at the pad centre. */
  target: number;
}

/**
 * Width of the ring that eases a pad back into the dunes, in metres.
 *
 * Metres rather than a multiple of the pad radius, which is what this used to
 * be. A proportional ring gives the small pads a *narrow* one — the camel
 * track's 8 m half-width earned a 5 m blend — so wherever a pad sat on sloping
 * ground the grading came out as a 50° collar ringing the landmark, the single
 * steepest thing in the region. A fixed ring makes the transition a function of
 * how much height it has to absorb, which is the thing that actually matters.
 */
const PAD_BLEND_METRES = 22;

function buildPads(region: RegionSpec): Pad[] {
  return region.pois.flatMap((poi) => {
    const spec = region.padFootprints[poi.id];
    if (!spec) return [];
    // The normalised radius that lands PAD_BLEND_METRES outside the ellipse
    // across its *narrow* axis, so the ring is at least that wide all the way
    // round and wider along the length.
    const blend = 1 + PAD_BLEND_METRES / Math.min(spec.lengthR, spec.widthR);
    return [{
      x: poi.x,
      z: poi.z,
      ca: Math.cos(spec.angle),
      sa: Math.sin(spec.angle),
      lengthR: spec.lengthR,
      widthR: spec.widthR,
      bound: Math.max(spec.lengthR, spec.widthR) * blend,
      blend,
      target: Number.NaN,
    }];
  });
}

// Everything above is a pure function of the active region, and nothing has
// computed it yet. This has to run before the first heightAt call.
refreshRegion();

export function heightAt(x: number, z: number): number {
  let h = rawHeightAt(x, z);
  for (const pad of D.pads) {
    const dx = x - pad.x;
    if (dx > pad.bound || dx < -pad.bound) continue;
    const dz = z - pad.z;
    if (dz > pad.bound || dz < -pad.bound) continue;
    const u = (dx * pad.ca + dz * pad.sa) / pad.lengthR;
    const v = (-dx * pad.sa + dz * pad.ca) / pad.widthR;
    const d = Math.sqrt(u * u + v * v);
    if (d >= pad.blend) continue;
    // Lazy: the target needs the raw field, which isn't callable at module init.
    if (Number.isNaN(pad.target)) pad.target = rawHeightAt(pad.x, pad.z);
    h += (pad.target - h) * (1 - smoothstep(1, pad.blend, d));
  }
  return h;
}

// --- surface ------------------------------------------------------------------

/**
 * What the ground is made of here. Traction reads `softness`; the terrain
 * shader reads all of it.
 *
 * The mineral fields are the point. Emirati dune sand is red because iron oxide
 * coats the grains, and the wind sorts those grains by size — the fine, heavily
 * stained ones climb to the crests while the coarse pale ones lag in the
 * interdune. So `iron` keys off exposure (how high up a dune, and how high up a
 * draa) rather than being noise with a warm colour: crests come out red, floors
 * come out grey-buff, and the reason is the same one it is out there.
 */
export interface Surface {
  /** 0 = hardpack gravel, 1 = deep loose sand. Drives the tyre model (§2). */
  softness: number;
  /** Iron-oxide staining, 0 = pale carbonate-rich, 1 = deep red. */
  iron: number;
  /**
   * How much of the great dune is under this point, 0..1. Its faces are scoured
   * and re-sorted by every wind that hits them, so they don't wear the same
   * surface as the field around them.
   */
  greatDune: number;
  /** Salt crust on a pan floor. */
  sabkha: number;
  /**
   * How much sky this point can see, 0 = interdune floor, 1 = crest. Drives the
   * grain sorting, and doubles as the ambient-occlusion term the shader bakes
   * into vertex colour (§4) — the two are the same quantity. A hollow between
   * two 40 m dunes has most of its hemisphere blocked by sand; a crest has all
   * of it. Ray-marched AO would compute exactly this, at a few thousand extra
   * height samples per chunk; the dune profile already knows it for free.
   */
  exposure: number;
}

export function surfaceAt(x: number, z: number): Surface {
  const s = duneSample(x, z);
  const { presence } = moreebAt(x, z);

  const base = fbm(x * 0.0035 + 40, z * 0.0035 - 25, 3);
  // Windward faces get packed hard by the wind; lee/slip faces stay loose.
  const lee = smoothstep(s.crest - 0.08, s.crest + 0.12, s.p);
  const natural = clamp01(
    clamp01(0.2 + base * 0.55 + lee * 0.4) * (0.35 + 0.65 * s.field),
  );
  // Spawn pan is hardpack: a stable reference surface for tuning. Applied only
  // to the traction value, never to the mineralogy below — the pan is a place
  // we scraped flat for the player's benefit, not a change in what the ground
  // is made of, and letting it feed the surface classification painted the
  // entire opening view as salt flat.
  // Rock is the firmest thing in the game, and it has to be: the whole point of
  // a jebel is that it is the one surface where the tyres finally bite. Applied
  // to traction *and* to the mineral fields below, because a grain-sorting model
  // has nothing to say about limestone.
  const rock = rockAt(x, z);
  const softness = natural * smoothstep(16, 70, Math.hypot(x, z)) * (1 - 0.94 * rock);

  // Exposure to the wind: the whole basis of the grain sorting.
  const exposure = clamp01(0.55 * s.profile + 0.45 * s.mega.top);
  // Broad regional variation, so the red isn't uniform across the whole map —
  // out there it comes in patches too, depending on what the sand came off.
  const patch = 0.58 + 0.42 * fbmRange(x * 0.0016 + 91, z * 0.0016 - 33, 2, 0.14);
  // The great dune runs redder than anything around it, and for the reason the
  // rest of the model already encodes: it is the highest, most exposed sand
  // here, so it collects the finest and most heavily iron-stained grains.
  const iron = clamp01(
    (0.16 + 0.78 * exposure) * patch + 0.16 * (natural - 0.35) + 0.3 * presence,
  ) * (1 - rock);

  // Salt pan: the flat, firm, low-lying floors between dune fields.
  // A salt pan can't be halfway up the great dune, whatever the field mask says.
  const sabkha = smoothstep(0.46, 0.26, s.field) * (1 - natural) * (1 - presence)
    * (1 - rock) * D.region.sabkhaAmount;

  return { softness, iron, greatDune: presence, sabkha, exposure };
}

/**
 * Sand softness alone, for the hot path — the tyre model asks per wheel per
 * physics step and doesn't care what colour the ground is.
 */
export function softnessAt(x: number, z: number): number {
  return surfaceAt(x, z).softness;
}

// --- crest queries ------------------------------------------------------------

/** A point on the nearest dune brink, and how pronounced that brink is. */
export interface CrestPoint {
  x: number;
  z: number;
  y: number;
  /** Dune amplitude at the brink, metres. Small means barely a ridge at all. */
  amp: number;
  softness: number;
}

/**
 * Walk from `(x, z)` onto the nearest crest line of the primary dune train.
 *
 * Closed form rather than a search: the phase is linear in `u`, so the distance
 * to the brink is just `(crest - p) * wavelength` along the wind axis, wrapped
 * to whichever side is nearer. Used by the crest sand plumes, which need a few
 * dozen crest points a second and can't afford to go hunting for them.
 */
export function crestNear(x: number, z: number): CrestPoint {
  const s = duneSample(x, z);
  const wavelength = D.region.wavelength;
  let d = (s.crest - s.p) * wavelength;
  if (d > wavelength / 2) d -= wavelength;
  if (d < -wavelength / 2) d += wavelength;
  const cx = x + WIND_X * d;
  const cz = z + WIND_Z * d;
  return {
    x: cx,
    z: cz,
    y: heightAt(cx, cz),
    amp: s.amp,
    softness: softnessAt(cx, cz),
  };
}
