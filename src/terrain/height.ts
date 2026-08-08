/**
 * The world's height and surface fields.
 *
 * Everything here is deterministic and side-effect free so the physics
 * heightfields, the render chunks and the traction model all read the exact
 * same ground.
 *
 * ## The region
 *
 * This is not "a desert" — it's the Al Badayer / Mleiha corridor in Sharjah,
 * the stretch of the Emirates that dune bashing actually happens in. Three
 * things about that place drive everything below:
 *
 *  - The sand is **red**. Inland Emirati dune sand is quartz with an iron-oxide
 *    coating on the grains, and the finer, more heavily stained grains get blown
 *    up onto the crests — so ridges run red-orange while the coarser, paler
 *    interdune floors stay grey-buff. That's a grain-sorting fact, and it's
 *    modelled as one (see `surfaceAt`) rather than painted on.
 *  - The dunes are **linear and layered**. The shamal blows out of the
 *    north-west and the dune trains here run roughly NNE–SSW, riding on top of
 *    much larger compound ridges (draa). A single dune scale reads as
 *    corrugated iron; the hierarchy is what makes a ridgeline look like
 *    landscape.
 *  - There is **rock in it**. The corridor is the margin of the sand sea, not
 *    its middle: limestone outcrops break through, and wadis run out of them and
 *    die in the sand. Unbroken dunes horizon-to-horizon is the one thing the
 *    real place isn't.
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

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
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
 * Dune trend for the corridor.
 *
 * `+Z` is north and `+X` is east — that's Compass's convention
 * (`atan2(forward.x, forward.z)`), and the POI bearings assume it too. The dune
 * trains between Al Badayer and Al Faya run close to NNE–SSW, driven by the
 * shamal out of the north-west, so crest lines sit on a bearing of about 20°
 * and the sand transport axis is perpendicular to them, on about 110°.
 *
 * Every downwind measurement in this file is along `u` and every along-crest one
 * is along `v`, so re-aiming the whole dune field is these two numbers and
 * nothing else.
 */
const CREST_BEARING = (20 * Math.PI) / 180;
export const WIND_X = Math.cos(CREST_BEARING);
export const WIND_Z = -Math.sin(CREST_BEARING);

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
const SLOPE_RESERVE = 0.1;

// --- the dune field -----------------------------------------------------------

const WAVELENGTH = 165;
/**
 * Compound ridge (draa) spacing. Real draa in the Emirates run 0.5–2 km apart
 * and carry the smaller dunes on their backs; 640 m puts three of them across
 * the curated region, which is enough for the horizon to have shape without the
 * player spending the whole session on one flank.
 */
const MEGA_WAVELENGTH = 640;

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
  return 0.24 + 0.76 * fbmRange(x * 0.0018 + 5, z * 0.0018 - 32, 3, 0.28);
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
  const phase = 2 * Math.PI * fract((u + wander) / MEGA_WAVELENGTH);
  const along = fbmRange(u * 0.0007 - 5, v * 0.0009 + 3, 2, 0.3);
  const amp = (18 + 28 * along) * mask;
  const top = 0.5 - 0.5 * Math.cos(phase);
  return {
    h: amp * top,
    slope: (amp * Math.PI * Math.sin(phase)) / MEGA_WAVELENGTH,
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
  const p = fract((u + wander) / WAVELENGTH);

  const local = fbmRange(u * 0.0018, v * 0.0016, 2, 0.24);
  // Superimposed dunes grow toward the top of the draa they sit on — the flanks
  // are swept, the crest accumulates.
  const wanted = (6 + 15 * local) * field * (0.5 + 0.6 * mega.top);

  // The draa's own descent eats into the budget where it falls away downwind,
  // which is exactly where a slip face would otherwise stack on top of it.
  const leeSlope = Math.max(0.18, TAN_REPOSE - Math.max(0, -mega.slope) - SLOPE_RESERVE);
  const maxAmp = WAVELENGTH / (PROFILE_PEAK * (1 / TAN_WINDWARD + 1 / leeSlope));
  const amp = Math.min(wanted, maxAmp);

  const crest = 1 - (PROFILE_PEAK * amp) / leeSlope / WAVELENGTH;
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

// --- limestone outcrops -------------------------------------------------------

/**
 * The corridor is the *margin* of the sand sea. Al Faya and the ridge the
 * fossil beds sit in break straight out of the dunes as bare rock, and their
 * silhouettes are half of what makes this stretch recognisable from the road.
 *
 * ## They are cuestas, and that is the whole design
 *
 * Jebel Faya is a **cuesta**: tilted beds eroded so that one flank is a long
 * gentle dip slope following the bedding, and the other is a short steep scarp
 * cut across it. Getting that right buys three things at once, which is why
 * this shape rather than a hill:
 *
 *  - It looks like the real thing. An asymmetric wedge has a *direction*; the
 *    dome this replaced had none, and read as a boulder the size of a hill.
 *  - It gives the flat-shaded style what it wants (§4). A cuesta is naturally
 *    made of a few big planes meeting at hard edges, which is exactly the
 *    Firewatch language — large flat colour fields and crisp silhouettes. The
 *    previous version quantised a smooth dome into small ledges, which produced
 *    fussy concentric stair-steps: too broken up to read as one clean shape and
 *    too smooth to read as rock.
 *  - **It is drivable.** The dip slope is a ramp to the summit, so the outcrop
 *    is somewhere to go rather than an obstacle to steer around. Climbing the
 *    back of the ridge and parking on the shelf is the best view in the region,
 *    and getting up there is a real dune-bashing problem — the ramp is steep
 *    enough that you have to carry momentum.
 *
 * Rock is added after the sand model and is exempt from the repose solver:
 * limestone doesn't avalanche, so the scarp is allowed to be a genuine cliff.
 */
interface Jebel {
  x: number;
  z: number;
  /** Strike direction — the axis the ridge runs along. */
  ca: number;
  sa: number;
  /** Half-length along strike. */
  strikeR: number;
  /** Distance from the dip-slope toe to the crest, metres. Sets the ramp angle. */
  dipRun: number;
  /** Distance from crest to scarp foot, metres. Sets the cliff angle. */
  scarpRun: number;
  /** Width of the flat summit shelf, metres. */
  shelf: number;
  height: number;
  /** Bedding benches on the dip slope. Few and large, or it turns to stairs. */
  benches: number;
  /** Stable id, so the plan-view faceting is deterministic per outcrop. */
  seed: number;
}

function jebel(spec: {
  x: number; z: number; bearingDeg: number; strikeR: number;
  dipRun: number; scarpRun: number; shelf: number; height: number;
  benches: number; seed: number;
}): Jebel {
  const a = (spec.bearingDeg * Math.PI) / 180;
  return { ...spec, ca: Math.cos(a), sa: Math.sin(a) };
}

// Dip runs are set from the grade they produce, not chosen for footprint: the
// ramp is `height / (dipRun - shelf)`, and the bedding benches multiply the
// steepest part of it by about 1.5 (see `beddingStair`). Both numbers below were
// picked by working backwards from a target climb angle and then confirmed by
// sampling a section across each ridge.
const JEBELS: Jebel[] = [
  // The fossil ridge. The big one, and the source of the wadi. Climbs at about
  // 22 degrees, touching 31 on the bench risers — a climb you have to commit to
  // and can bog halfway up, with the highest ground for kilometres as the payoff.
  jebel({
    x: 330, z: -580, bearingDeg: 32, strikeR: 150,
    dipRun: 179, scarpRun: 44, shelf: 26, height: 62, benches: 3, seed: 11,
  }),
  // A long low spine on the western edge — a horizon feature you navigate by
  // long before you reach it. About 14 degrees: the one you can get up without
  // thinking about it, so there's an easy summit and a hard one rather than two
  // of the same.
  jebel({
    x: -640, z: 250, bearingDeg: 10, strikeR: 210,
    dipRun: 170, scarpRun: 30, shelf: 18, height: 38, benches: 2, seed: 29,
  }),
];

/**
 * Local coordinates for an outcrop: `s` along strike in metres, `v` across the
 * dip direction in metres with 0 at the crest line (negative = up the dip
 * slope, positive = out over the scarp).
 *
 * The faceting lives here rather than in the height function. `s` is quantised
 * into a handful of segments and each segment is given a fixed setback, so the
 * cliff top steps in and out in straight sections instead of curving. That is
 * what turns the scarp into a row of flat buttress faces meeting at vertical
 * corners — angular by construction. A smooth noise offset, which is what this
 * used to do, gives you a wobbly cliff, and a wobbly cliff under flat shading
 * is just noise.
 *
 * `setback` moves **only the top of the scarp**, never the crest line the ramp
 * climbs to. Applying it to the crest is the obvious thing and it is wrong: the
 * setback is piecewise constant, so it puts a vertical step at every segment
 * boundary, and if the ramp's geometry depends on it those steps land across the
 * ramp as 13 m walls every 33 m. Sampling a section found exactly that — a
 * "drivable" slope that was really a flight of stairs. On the cliff the same
 * discontinuity is the feature.
 */
function jebelLocal(j: Jebel, x: number, z: number): { s: number; v: number; setback: number } {
  const dx = x - j.x;
  const dz = z - j.z;
  const s = dx * j.ca + dz * j.sa;
  const v = -dx * j.sa + dz * j.ca;
  // Two scales of segment rather than one. A single uniform partition gives
  // every buttress the same width and the cliff top comes out as an even
  // zigzag — it reads as a saw blade, not as rock. Overlaying a coarse
  // partition with a finer one produces broad faces that are themselves
  // stepped, and because the two boundaries rarely coincide, the run lengths
  // vary on their own without needing any noise.
  const coarse = Math.floor((s / j.strikeR) * 1.7);
  const fine = Math.floor((s / j.strikeR) * 5.3);
  const setback =
    (hash2(coarse, j.seed) - 0.5) * 0.72 +
    (hash2(fine, j.seed + 7717) - 0.5) * 0.34;
  return { s, v, setback };
}

/**
 * Bedding benches on the dip slope: flatter treads separated by steeper risers.
 *
 * The obvious implementation — quantise with `round()` and lerp toward it — is
 * what this replaced, and it made the ramp unclimbable. A rounded staircase is
 * *discontinuous*, so each bench edge is a vertical wall however small you make
 * the blend; sampling the first version found 60° steps sitting in the middle of
 * an 11° slope. This version keeps the staircase continuous and its gradient
 * bounded: the riser is a smoothstep, so the steepest point is a known multiple
 * (about 3.7x) of the mean grade, and `blend` buys strata at a price in slope
 * you can actually calculate before you drive into it.
 */
function beddingStair(t: number, benches: number, blend: number): number {
  const c = t * benches;
  const i = Math.floor(c);
  const riser = smoothstep(0.6, 1, c - i);
  return lerp(t, (i + riser) / benches, blend);
}

/** How much of the mean grade a bench riser adds. See `beddingStair`. */
const BENCH_BLEND = 0.18;

/**
 * Where bare rock is showing, 0..1. Drives colour and traction.
 *
 * Derived by comparing the rock surface against the sand rather than from a
 * separate falloff, so the limestone colour cannot drift out of register with
 * the limestone geometry. It also gets the interesting part right for free: the
 * toe of the ramp, where sand has banked over the bedding, comes out as sand
 * because that is literally what is on top there.
 */
export function rockAt(x: number, z: number): number {
  const top = jebelHeightAt(x, z);
  if (top === -Infinity) return 0;
  return smoothstep(-1.5, 1.5, top - duneGroundAt(x, z));
}

/**
 * Ground elevation each outcrop stands on, sampled once from the dune field.
 *
 * Rock has to be positioned against an absolute datum, not added to whatever
 * the sand happens to be doing underneath it. Added, the "flat" summit shelf
 * inherits every metre of dune relief below it and comes out tilted — which
 * defeats the one job the shelf has, which is to be somewhere you can stop the
 * truck and look. Lazy for the usual reason: it needs the height field, which
 * isn't callable while this module is initialising.
 */
const jebelBase = new Map<Jebel, number>();

function baseOf(j: Jebel): number {
  let base = jebelBase.get(j);
  if (base === undefined) {
    base = duneGroundAt(j.x, j.z);
    jebelBase.set(j, base);
  }
  return base;
}

/**
 * Absolute top-of-rock elevation here, or -Infinity off the outcrops.
 *
 * The caller takes the max of this and the sand, so the rock punches up through
 * the dune field and the dunes still bank against its flanks wherever they are
 * higher than its skirt — which is what the real interface looks like, sand
 * drifted up against stone rather than stone sitting on a plinth of sand.
 */
function jebelHeightAt(x: number, z: number): number {
  let top = -Infinity;
  for (const j of JEBELS) {
    const { s, v, setback } = jebelLocal(j, x, z);

    // The crest line is straight — see the note in `jebelLocal`. Only the brink,
    // where the shelf gives way to the cliff, steps per segment.
    const toe = -j.dipRun;
    const brink = setback * j.scarpRun * 0.55;
    // Generous bounds. Every surface below runs *past* where the rock meets the
    // sand and keeps going down, so the caller's `max` against the dune field
    // finds the crossing on its own. Stopping the rock surface at zero instead
    // leaves its skirt as a horizontal plane at the outcrop's datum, and every
    // hollow in the sand around it then reads as a 10 m step — which is exactly
    // what the first sampling run of this shape found ringing both outcrops.
    if (v < toe - 60 || v > brink + j.scarpRun * 1.9) continue;
    if (Math.abs(s) > j.strikeR * 1.25) continue;

    let local: number;
    if (v <= -j.shelf) {
      // Dip slope: a linear bedding plane, which is both what the rock does and
      // what is predictable to drive up. `t` is deliberately unclamped below 0
      // so the plane continues under the sand past the toe.
      const t = (v - toe) / (j.dipRun - j.shelf);
      local = j.height * (t < 0 ? t * 1.6 : beddingStair(Math.min(t, 1), j.benches, BENCH_BLEND));
    } else if (v <= brink) {
      // The summit shelf: dead flat, and wide enough to park on and look.
      local = j.height;
    } else {
      // The scarp: near-vertical where it breaks at the brink, easing into a
      // talus apron of shed rubble at the foot. Steepest at the top is the way
      // round a cliff actually weathers; the mirror of it gives a dome with a
      // sharp skirt, which is a hill, not a scarp. Signed so it keeps falling
      // past the foot and dives under the sand.
      const t = (v - brink) / j.scarpRun;
      local = j.height * (1 - t) * Math.abs(1 - t);
    }

    // The ends of the ridge. A cuesta terminates in a steep nose, so this dives
    // hard rather than tapering — but it dives *below* the sand, so how much of
    // the nose you actually see is decided by the dunes banked against it.
    const endT = clamp01((Math.abs(s) / j.strikeR - 0.68) / 0.32);
    local -= endT * (j.height + 40);

    top = Math.max(top, baseOf(j) + local);
  }
  return top;
}

// --- the wadi -----------------------------------------------------------------

/**
 * A gravel wash running out of the fossil ridge and dying in the sand.
 *
 * This is what the sand-sea margin actually looks like: the rare rain comes off
 * the rock, cuts a flat-floored channel through the dunes, and loses the fight
 * a few hundred metres out. It earns its place in the drive too — it's the one
 * piece of firm, fast, flat ground in the region, so it reads as a road without
 * anyone having built one.
 */
const WADI = {
  x0: 190,
  z0: -660,
  /** Bearing 315° — out of the ridge, away to the north-west. */
  dirX: -Math.SQRT1_2,
  dirZ: Math.SQRT1_2,
  length: 300,
  halfWidth: 20,
  bankWidth: 28,
  depth: 5.5,
  meander: 24,
  /** Radians per metre along the channel; ~330 m per meander. */
  meanderRate: 0.019,
  /** How far in from each end the channel fades up to grade. */
  headFade: 45,
  tailFade: 150,
  /**
   * Hard ceiling on how far the channel may lower the ground.
   *
   * Without it, the floor's monotonic descent meets a dune that happens to lie
   * across the line and the grading obediently cuts a 30 m canyon through it,
   * with banks at 50°. Water in sand does not do that — it ponds, spreads, and
   * goes around. Capping the cut turns those crossings into the shallow braided
   * trough they should be, and keeps the bank slope bounded by
   * `maxCut / bankWidth` everywhere.
   */
  maxCut: 7,
};

/** Centreline offset perpendicular to the axis, at distance `s` along it. */
function wadiMeander(s: number): number {
  return WADI.meander * Math.sin(s * WADI.meanderRate);
}

/** Along/lateral coordinates in the channel's own frame. */
function wadiFrame(x: number, z: number): { s: number; lateral: number } {
  const dx = x - WADI.x0;
  const dz = z - WADI.z0;
  const s = dx * WADI.dirX + dz * WADI.dirZ;
  const n = -dx * WADI.dirZ + dz * WADI.dirX;
  return { s, lateral: Math.abs(n - wadiMeander(s)) };
}

/** 0 outside the wash, 1 on the channel floor. */
export function wadiAt(x: number, z: number): number {
  const { s, lateral } = wadiFrame(x, z);
  if (s < -WADI.bankWidth || s > WADI.length + WADI.bankWidth) return 0;
  const across = 1 - smoothstep(WADI.halfWidth, WADI.halfWidth + WADI.bankWidth, lateral);
  if (across <= 0) return 0;
  const along =
    smoothstep(0, WADI.headFade, s) *
    smoothstep(WADI.length, WADI.length - WADI.tailFade, s);
  return across * along;
}

/**
 * The channel floor's height profile, sampled lazily along the axis.
 *
 * A wadi floor is *graded* — water cut it, so it's flat across and runs
 * monotonically downhill. Subtracting a fixed channel shape from the dune field
 * would instead give a trench with dunes in the bottom of it, which is not a
 * thing water has ever produced. So the floor is built from the pre-wadi ground
 * along the centreline, forced to descend by a running minimum, and the ground
 * is then graded toward it.
 *
 * Sampled lazily for the same reason the POI pads are: it needs the height
 * field, which isn't callable while this module is still initialising.
 */
const WADI_SAMPLES = 24;
let wadiFloor: Float32Array | null = null;

function wadiFloorAt(s: number): number {
  if (!wadiFloor) {
    wadiFloor = new Float32Array(WADI_SAMPLES + 1);
    let running = Infinity;
    for (let i = 0; i <= WADI_SAMPLES; i++) {
      const t = (i / WADI_SAMPLES) * WADI.length;
      const off = wadiMeander(t);
      const cx = WADI.x0 + WADI.dirX * t - WADI.dirZ * off;
      const cz = WADI.z0 + WADI.dirZ * t + WADI.dirX * off;
      running = Math.min(running, sandHeightAt(cx, cz));
      wadiFloor[i] = running;
    }
  }
  const t = clamp01(s / WADI.length) * WADI_SAMPLES;
  const i = Math.min(WADI_SAMPLES - 1, Math.floor(t));
  return lerp(wadiFloor[i], wadiFloor[i + 1], t - i) - WADI.depth;
}

// --- assembly -----------------------------------------------------------------

/**
 * The dune field alone — no rock, no wadi.
 *
 * Split out because both of those need to sample the ground they are placed
 * against: the outcrops need a datum to stand their summit shelf on, and the
 * wadi needs the profile of what it is cutting. Going through `sandHeightAt`
 * for that would recurse.
 */
function duneGroundAt(x: number, z: number): number {
  const s = duneSample(x, z);

  // Broad regional swell everything else sits on. Kept low-amplitude: with the
  // draa scale doing the heavy lifting now, this is only here to stop the
  // interdune floors from being level with each other.
  let h = fbm(x * 0.002 + 3, z * 0.002 - 9, 3) * 16;

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
  let sculpted = 0;
  // A big steep-faced dune: the momentum-climb proving ground.
  sculpted += ridgeBump(x, z, 470, -260, 0.4, 150, 115, 44);
  // A long sidehill traverse: rollover tension without a cliff at the end.
  sculpted += ridgeBump(x, z, -430, 300, 1.9, 250, 88, 30);
  // A short sharp kicker for airtime and landing compression. The steepest of
  // the four on purpose — it's a lip you leave the ground over, not a climb.
  sculpted += ridgeBump(x, z, -150, -520, 0.2, 80, 52, 18);
  // A broad high ridge to give the horizon something to do.
  sculpted += ridgeBump(x, z, 120, 760, 2.5, 420, 150, 52);
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

/**
 * The sand model plus rock: everything the wadi is allowed to cut into.
 *
 * `max` rather than `+`: an outcrop is bedrock standing in the sand sea at its
 * own elevation, not a lump added to whatever the dunes are doing. Taking the
 * higher of the two also gets the interface right for free — the rock wins
 * where it stands proud, and the dunes win where they have drifted up over its
 * skirt.
 */
function sandHeightAt(x: number, z: number): number {
  return Math.max(duneGroundAt(x, z), jebelHeightAt(x, z));
}

/** The full landscape, before POI pads. Pad targets are sampled from this. */
function rawHeightAt(x: number, z: number): number {
  const h = sandHeightAt(x, z);
  const w = wadiAt(x, z);
  if (w <= 0) return h;
  const { s } = wadiFrame(x, z);
  const floor = Math.max(wadiFloorAt(s), h - WADI.maxCut);
  return h + (floor - h) * w;
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
  /** Bare limestone. */
  rock: number;
  /** Water-worked wadi gravel. */
  wadi: number;
  /** Salt crust on a pan floor. */
  sabkha: number;
}

export function surfaceAt(x: number, z: number): Surface {
  const s = duneSample(x, z);
  const rock = rockAt(x, z);
  const wadi = wadiAt(x, z);

  const base = fbm(x * 0.0035 + 40, z * 0.0035 - 25, 3);
  // Windward faces get packed hard by the wind; lee/slip faces stay loose.
  const lee = smoothstep(s.crest - 0.08, s.crest + 0.12, s.p);
  // Neither rock nor a scoured gravel bed holds loose sand.
  const natural = clamp01(
    clamp01(0.2 + base * 0.55 + lee * 0.4) * (0.35 + 0.65 * s.field) * (1 - rock) * (1 - 0.85 * wadi),
  );
  // Spawn pan is hardpack: a stable reference surface for tuning. Applied only
  // to the traction value, never to the mineralogy below — the pan is a place
  // we scraped flat for the player's benefit, not a change in what the ground
  // is made of, and letting it feed the surface classification painted the
  // entire opening view as salt flat.
  const softness = natural * smoothstep(16, 70, Math.hypot(x, z));

  // Exposure to the wind: the whole basis of the grain sorting.
  const exposure = clamp01(0.55 * s.profile + 0.45 * s.mega.top);
  // Broad regional variation, so the red isn't uniform across the whole map —
  // out there it comes in patches too, depending on what the sand came off.
  const patch = 0.58 + 0.42 * fbmRange(x * 0.0016 + 91, z * 0.0016 - 33, 2, 0.14);
  const iron = clamp01((0.16 + 0.78 * exposure) * patch + 0.16 * (natural - 0.35));

  // Salt pan: the flat, firm, low-lying floors between dune fields.
  const sabkha = smoothstep(0.46, 0.26, s.field) * (1 - natural) * (1 - rock);

  return { softness, iron, rock, wadi, sabkha };
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
 * to the brink is just `(crest - p) * WAVELENGTH` along the wind axis, wrapped
 * to whichever side is nearer. Used by the crest sand plumes, which need a few
 * dozen crest points a second and can't afford to go hunting for them.
 */
export function crestNear(x: number, z: number): CrestPoint {
  const s = duneSample(x, z);
  let d = (s.crest - s.p) * WAVELENGTH;
  if (d > WAVELENGTH / 2) d -= WAVELENGTH;
  if (d < -WAVELENGTH / 2) d += WAVELENGTH;
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
