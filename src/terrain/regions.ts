import type { Poi, PoiKind } from '../data/pois';
import { LIWA_POIS } from '../data/pois';
import { FOSSIL_ROCK_POIS } from '../data/fossilRockPois';
import { BADAYER_POIS } from '../data/badayerPois';

/**
 * The places you can drive.
 *
 * The terrain has always been a pure function of (x, z) plus a page of
 * module-level constants — crest bearing, wavelengths, mask offsets, the great
 * dune's dimensions. A region is just a named set of those constants plus its
 * own points of interest and palette, so "another map" costs a data file rather
 * than a second terrain generator.
 *
 * §11 said "curated single region only", which was a rule against a
 * procedurally infinite world rather than against having more than one place.
 * Two hand-authored regions keep the curation; nothing here is endless.
 *
 * The active region is module-level mutable state rather than a parameter
 * threaded through every call. `heightAt` is called a few hundred thousand
 * times per chunk build and from the physics hot path, and giving it a region
 * argument would mean touching every caller including the ones inside shaders
 * and workers. Swapping a pointer is the honest trade: it is global state, and
 * the whole world has to be torn down when it changes (see Game.changeRegion).
 */

/** A hand-placed elliptical ridge added on top of the procedural field. */
export interface SculptedBump {
  x: number;
  z: number;
  angle: number;
  lengthR: number;
  widthR: number;
  height: number;
}

/** The one enormous dune a region is built around, if it has one. */
export interface GreatDuneSpec {
  x: number;
  z: number;
  /** Crest bearing, radians. */
  bearing: number;
  /** Half-length of the crest line. */
  crestR: number;
  height: number;
  /** Horizontal run of the climb face. */
  climbRun: number;
  /** Horizontal run of the slip face. */
  slipRun: number;
  /** Flat-ish crest to stop on. */
  crown: number;
  /**
   * Fraction of the crest half-length over which the ends taper away. Small
   * values make a pointed nose and a very steep end flank — this was the single
   * steepest thing in Liwa before it was solved for.
   */
  taper: number;
}

/**
 * A limestone massif: the thing Fossil Rock has and Liwa deliberately doesn't.
 *
 * Modelled as an elliptical plateau with a scarp on one side and a long talus
 * ramp on the other, rather than as the faceted, bench-stepped cuesta the first
 * attempt used. That version put 13m vertical walls across its own drivable
 * ramp every 33m, because the plan-view faceting moved the crest line between
 * facets and the bedding benches were quantised with `round()`. Both problems
 * are avoided here by construction: the footprint is a smooth ellipse and the
 * profile is a single continuous curve with no steps in it.
 */
export interface MassifSpec {
  x: number;
  z: number;
  /** Long-axis bearing, radians. */
  bearing: number;
  /** Half-length along the ridge. */
  lengthR: number;
  /** Half-width across it, at the plateau edge. */
  widthR: number;
  height: number;
  /**
   * How far the flanks reach out past the plateau, as a multiple of widthR.
   * The scarp side uses a fraction of this, the ramp side all of it.
   */
  flare: number;
  /** Fraction of `flare` the steep side gets. Lower is a harder scarp. */
  scarp: number;
  /**
   * Cross-section exponents, as `height = H * (1 - t^p)` out from the crest.
   *
   * These are the whole shape and they are counter-intuitive: p below 1 gives a
   * *peaked* crest with flat skirts, p above 1 gives a flat crest with steep
   * edges. The first cut used 0.55 for both sides and produced a knife-edge
   * ridge whose flanks flattened out — the exact opposite of a jebel.
   *
   * `ramp` wants to be just above 1: near-linear, so the climb is an even grade
   * the whole way with no step at the top. `scarp` wants to be well above 1, so
   * the plateau runs out to the brink and then falls off it.
   */
  rampPower: number;
  scarpPower: number;
}

export interface RegionPalette {
  /** Iron-stained crest sand. */
  sandIron: number;
  /** Coarse, pale, carbonate-rich interdune sand. */
  sandPale: number;
  /** Wind-scoured gravel showing through where sand runs thin. */
  gravel: number;
  /** Salt crust on a pan floor. */
  sabkha: number;
  /** The great dune's own faces, and the most saturated thing in a region. */
  duneCrest: number;
  /** Exposed limestone, where a region has any. */
  rock: number;
  /** Airborne sand, for dust and crest plumes. */
  airborne: number;
}

export interface RegionSpec {
  id: RegionId;
  /** Shown on the picker card. */
  name: string;
  /** Where this is, in one line. */
  where: string;
  /** What it's like to drive, in one line. */
  blurb: string;

  /** Dune trend. +Z is north, +X is east. */
  crestBearing: number;
  /** Primary dune train spacing, metres. */
  wavelength: number;
  /** Compound ridge (draa) spacing, metres. */
  megaWavelength: number;
  /** Amplitude of the broad regional swell everything sits on. */
  swell: number;

  /** Floor and frequency of the dune-field mask. Low values are open flats. */
  fieldFloor: number;
  fieldFreq: number;
  fieldOffsetX: number;
  fieldOffsetZ: number;
  /** Remap spread of the mask. Tight values put a cliff at every boundary. */
  fieldSpread: number;

  sculpted: SculptedBump[];
  greatDune: GreatDuneSpec | null;
  massif: MassifSpec | null;

  palette: RegionPalette;
  pois: Poi[];
  /** Pad footprints for the landmarks this region places. */
  padFootprints: Partial<Record<PoiKind, { lengthR: number; widthR: number; angle: number }>>;
  /** Scales the ground dressing — Mleiha's gravel plains carry more scrub. */
  scatterBias: number;
  /**
   * How much of the open low ground is salt pan, 0..1.
   *
   * Not cosmetic. The classifier turns any low, flat, firm ground pale grey, and
   * Fossil Rock's low ground is *gravel plain* — so at Liwa's setting the whole
   * region came out dotted with white domes that read as bleached nothing. A
   * region without sabkha in it needs to say so.
   */
  sabkhaAmount: number;
  /** How strongly the serir underneath shows through thin sand, 0..1. */
  gravelAmount: number;
}

export type RegionId = 'liwa' | 'fossilrock' | 'badayer';

/**
 * Liwa, around Tal Moreeb. Deep sand sea: no rock anywhere, because an outcrop
 * in the Rub' al Khali is the one thing that would read as wrong.
 */
const LIWA: RegionSpec = {
  id: 'liwa',
  name: 'Liwa',
  where: 'Rub’ al Khali, Abu Dhabi',
  blurb: 'Deep sand sea and the great dune. Nothing but sand in every direction.',

  // Liwa's megadune trains run roughly WNW-ESE under the shamal, so crest lines
  // sit near a bearing of 105 degrees and the transport axis is close to 15.
  crestBearing: (105 * Math.PI) / 180,
  wavelength: 165,
  // Liwa's draa run 1-2km apart and carry the smaller dunes on their backs;
  // 810m is a compression of that, and puts not quite two across the region.
  megaWavelength: 810,
  swell: 16,

  fieldFloor: 0.24,
  fieldFreq: 0.0018,
  fieldOffsetX: 5,
  fieldOffsetZ: -32,
  fieldSpread: 0.28,

  sculpted: [
    // A long sidehill traverse: rollover tension without a cliff at the end.
    { x: -430, z: 300, angle: 1.9, lengthR: 250, widthR: 88, height: 30 },
    // A short sharp kicker for airtime. The steepest of the three on purpose —
    // it's a lip you leave the ground over, not a climb.
    { x: -150, z: -520, angle: 0.2, lengthR: 80, widthR: 52, height: 18 },
    // A broad high ridge to give the horizon something to do.
    { x: 120, z: 760, angle: 2.5, lengthR: 420, widthR: 150, height: 52 },
  ],

  greatDune: {
    x: 300,
    z: -210,
    bearing: (52 * Math.PI) / 180,
    crestR: 320,
    height: 120,
    climbRun: 285,
    slipRun: 280,
    crown: 26,
    taper: 0.54,
  },
  massif: null,

  palette: {
    sandIron: 0xba6b3e,
    sandPale: 0xcaa887,
    gravel: 0xa1907c,
    sabkha: 0xd8cec0,
    duneCrest: 0xa8552c,
    rock: 0x9c8b76,
    airborne: 0xd9a273,
  },
  pois: LIWA_POIS,
  padFootprints: {
    falaj: { lengthR: 26, widthR: 6, angle: 0.5 },
    ghaf: { lengthR: 5, widthR: 5, angle: 0 },
    watchtower: { lengthR: 11, widthR: 11, angle: 0 },
    majlis: { lengthR: 9, widthR: 9, angle: 0 },
    // A drilling location is bulldozed level before anything is put on it, so
    // this is the one pad in the world that is historically the point rather
    // than a concession to the geometry. Kept tight to the derrick: the capped
    // holes scattered around the site sit on their own ground, half-buried,
    // which is what fifty years of sand does to them.
    oilwell: { lengthR: 13, widthR: 13, angle: 0.72 },
    teastand: { lengthR: 4.5, widthR: 4.5, angle: 0 },
    falconry: { lengthR: 8, widthR: 6, angle: 0 },
    cameltrack: { lengthR: 42, widthR: 8, angle: 0 },
    coffeehearth: { lengthR: 3, widthR: 3, angle: 0 },
    oasis: { lengthR: 16, widthR: 14, angle: 0 },
  },
  scatterBias: 1,
  sabkhaAmount: 1,
  gravelAmount: 0.45,
};

/**
 * Fossil Rock — Jebel Maleihah, inland Sharjah.
 *
 * The visual opposite of Liwa and the reason to have a second map at all: a
 * grey limestone massif standing straight out of red sand, with the Al Faya
 * ridge behind it. The rock was a seabed in the Cretaceous, which is why the
 * place is named for what people find on it.
 *
 * It drives differently too. The dunes here are smaller and closer together
 * than Liwa's, the interdune ground is firm gravel plain rather than sabkha,
 * and there is a hard, immovable object in the middle of the map — the first
 * thing in this game that is genuinely in the way.
 */
const FOSSIL_ROCK: RegionSpec = {
  id: 'fossilrock',
  name: 'Fossil Rock',
  where: 'Jebel Maleihah, Mleiha, Sharjah',
  blurb: 'Red dunes running up against a limestone seabed. Tighter, faster, harder ground.',

  // The Mleiha dunes run closer to N-S than Liwa's, banked against the ridge.
  crestBearing: (78 * Math.PI) / 180,
  // Smaller and tighter than Liwa: this is a dune field, not a sand sea.
  wavelength: 118,
  megaWavelength: 520,
  swell: 11,

  // Much lower floor and a wider swing, because the open gravel plains between
  // the dune belts are half of what this place looks like.
  fieldFloor: 0.12,
  fieldFreq: 0.0026,
  fieldOffsetX: -61,
  fieldOffsetZ: 18,
  fieldSpread: 0.34,

  sculpted: [
    // The dune ramp that piles against the massif's western flank — the line
    // everyone actually drives at Fossil Rock.
    { x: -120, z: -40, angle: 1.35, lengthR: 300, widthR: 110, height: 34 },
    // A run of steep transverse dunes out on the open plain, for the bit of
    // the drive that isn't about the rock.
    { x: 380, z: 420, angle: 0.45, lengthR: 190, widthR: 70, height: 26 },
    { x: -520, z: 430, angle: 0.9, lengthR: 160, widthR: 60, height: 22 },
  ],

  greatDune: null,
  massif: {
    x: 210,
    z: -170,
    bearing: (28 * Math.PI) / 180,
    lengthR: 300,
    widthR: 105,
    height: 96,
    flare: 2.4,
    // A hard western scarp and a long eastern talus — the ramp is the only way
    // up, which is what makes finding it worth something.
    scarp: 0.34,
    // 96m of rise over 252m of ramp is a 21 degree mean, peaking near 24 at the
    // foot — a climb that asks for a run-up and gives it back.
    rampPower: 1.15,
    // 96m over 86m is a cliff whatever you do with it; 4 puts the drop in the
    // outer third and leaves the top flat enough to stand on.
    scarpPower: 4,
  },

  palette: {
    // Mleiha's sand is the redder end of the Emirati range; the rock is a cool
    // pale grey, and that contrast is the entire reason to come here.
    sandIron: 0xb35a2e,
    sandPale: 0xc59a72,
    gravel: 0x9a8c78,
    sabkha: 0xcfc6b6,
    duneCrest: 0x9e4a25,
    rock: 0x7d7a72,
    airborne: 0xd49a68,
  },
  pois: FOSSIL_ROCK_POIS,
  padFootprints: {
    watchtower: { lengthR: 11, widthR: 11, angle: 0 },
    coffeehearth: { lengthR: 3, widthR: 3, angle: 0 },
    falaj: { lengthR: 26, widthR: 6, angle: 0.5 },
    ghaf: { lengthR: 5, widthR: 5, angle: 0 },
    teastand: { lengthR: 4.5, widthR: 4.5, angle: 0 },
    fossilbed: { lengthR: 12, widthR: 9, angle: 0.7 },
    tomb: { lengthR: 9, widthR: 9, angle: 0 },
    cameltrack: { lengthR: 42, widthR: 8, angle: 0 },
    falconry: { lengthR: 8, widthR: 6, angle: 0 },
  },
  // The gravel plains here carry noticeably more scrub than deep sand does.
  scatterBias: 1.45,
  // Mleiha's interdune is serir — wind-scoured gravel — not salt crust. A trace
  // of pan survives in the very lowest hollows and nowhere else.
  sabkhaAmount: 0.15,
  gravelAmount: 0.72,
};

/**
 * Al Badayer — "Big Red", on the Dubai–Hatta road.
 *
 * The third region exists to cover the axis the first two miss. Liwa is scale:
 * one enormous dune and nothing else for kilometres. Fossil Rock is contrast:
 * rock against sand, firm ground, an obstacle. Neither of them is *busy*, and
 * busy is what dune bashing in the UAE actually looks like — an hour from the
 * city, a petrol station at the entrance, tyre tracks over every face by nine
 * in the morning.
 *
 * So this is the dense one. Tight dune trains close together, almost no open
 * ground between them, and the reddest sand of the three — Badayer's iron
 * content is the whole reason the place is called Big Red. There is no massif
 * and no far horizon: the rim ridges close the bowl in, and what you can see
 * from anywhere in it is more dunes.
 *
 * It drives shortest-period of the three. Liwa lets you carry speed for a
 * kilometre; here a crest arrives every hundred metres and the game becomes
 * reading the next one rather than committing to a long line.
 */
const BADAYER: RegionSpec = {
  id: 'badayer',
  name: 'Al Badayer',
  where: 'Big Red, Dubai–Hatta road, Sharjah',
  blurb: 'The busy one. Steep red bowls, a crest every hundred metres, no horizon to speak of.',

  // Badayer's trains run much closer to N-S than Liwa's WNW-ESE, banked along
  // the road rather than across the open sand sea.
  crestBearing: (18 * Math.PI) / 180,
  // The tightest of the three, and the number that does most of the work: at a
  // 96m period you are cresting something every few seconds.
  wavelength: 96,
  megaWavelength: 430,
  swell: 24,

  // The highest floor of the three — this is a dune field with barely any gaps
  // in it, which is the opposite of Fossil Rock's gravel plains at 0.12.
  fieldFloor: 0.52,
  fieldFreq: 0.0031,
  fieldOffsetX: 143,
  fieldOffsetZ: 77,
  // Wide spread, so what open ground there is arrives as a soft bowl floor
  // rather than as a hard edge between field and flat.
  fieldSpread: 0.42,

  sculpted: [
    // The rim. Four long arcs set around the centre, which is as close to a
    // ring as elliptical bumps get — enough that from the middle of the bowl
    // every direction is uphill, which is the feeling the place is built on.
    { x: 0, z: -620, angle: 0.1, lengthR: 460, widthR: 150, height: 58 },
    { x: 610, z: 40, angle: 1.62, lengthR: 430, widthR: 145, height: 54 },
    { x: -30, z: 640, angle: 0.06, lengthR: 470, widthR: 155, height: 50 },
    { x: -600, z: -20, angle: 1.55, lengthR: 420, widthR: 140, height: 56 },
    // And the corners. Four arcs leave the diagonals open — measured, only 8 of
    // 12 bearings out of the centre ran uphill — so these close the ring. Lower
    // than the main rim on purpose: a bowl with a perfectly even wall reads as
    // a crater, and the gaps between these are the ways out.
    { x: 430, z: -430, angle: 0.78, lengthR: 300, widthR: 120, height: 44 },
    { x: 440, z: 440, angle: 2.36, lengthR: 300, widthR: 120, height: 41 },
    { x: -430, z: 440, angle: 0.78, lengthR: 300, widthR: 120, height: 43 },
    { x: -440, z: -430, angle: 2.36, lengthR: 300, widthR: 120, height: 46 },
    // Two steep kickers on the bowl floor. Short and sharp: lips you leave the
    // ground over rather than climbs.
    { x: -210, z: -260, angle: 0.85, lengthR: 74, widthR: 46, height: 17 },
    { x: 300, z: 340, angle: 2.3, lengthR: 82, widthR: 50, height: 19 },
  ],

  // Big Red itself. Lower than Tal Moreeb and far broader — it is famous for
  // being climbable, not for being the tallest thing in the country, and a
  // wide crown is what lets a queue of vehicles sit on top of it.
  greatDune: {
    // Well clear of the origin, and that distance is load-bearing. At (40,-120)
    // the spawn landed on Big Red's climb face at 64m and a 31 degree slope,
    // which crashed the region outright. The spawn pan now flattens the whole
    // field rather than only the dune field, so that can no longer NaN — but a
    // 75m disc scooped out of the dune's toe to achieve it would look exactly
    // as wrong as it sounds. Keeping the dune off the spawn is the real fix;
    // the pan is the backstop.
    x: 150,
    z: -340,
    bearing: (100 * Math.PI) / 180,
    crestR: 240,
    height: 86,
    // A gentler grade than Liwa's on purpose: 86m over 250m is about 19
    // degrees, which almost anything gets up with a run at it.
    climbRun: 250,
    slipRun: 175,
    crown: 40,
    taper: 0.62,
  },
  massif: null,

  palette: {
    // The reddest of the three, and not by a little. Badayer sand is heavily
    // iron-stained and reads almost brick in low sun, which is the single most
    // recognisable thing about the place.
    sandIron: 0xa8512a,
    sandPale: 0xbe8a5f,
    gravel: 0x98836a,
    sabkha: 0xcfc2ae,
    duneCrest: 0x8d3c1c,
    // No rock here at all; kept in range of the sand so anything that does
    // sample it cannot print a grey hole in a red bowl.
    rock: 0x8a7867,
    airborne: 0xcf8a52,
  },
  pois: BADAYER_POIS,
  padFootprints: {
    teastand: { lengthR: 4.5, widthR: 4.5, angle: 0 },
    coffeehearth: { lengthR: 3, widthR: 3, angle: 0 },
    ghaf: { lengthR: 5, widthR: 5, angle: 0 },
    majlis: { lengthR: 9, widthR: 9, angle: 0 },
    falconry: { lengthR: 8, widthR: 6, angle: 0 },
    cameltrack: { lengthR: 42, widthR: 8, angle: 0 },
    oasis: { lengthR: 16, widthR: 14, angle: 0 },
  },
  // More than Liwa's deep sand, less than Mleiha's gravel plains: there is
  // scrub along the margins here and almost none on the faces.
  scatterBias: 1.1,
  // Effectively none. A bowl of active dunes has nowhere for a pan to form.
  sabkhaAmount: 0.08,
  // Some serir shows in the hollows, but the sand is deep nearly everywhere.
  gravelAmount: 0.28,
};

export const REGIONS: Record<RegionId, RegionSpec> = {
  liwa: LIWA,
  fossilrock: FOSSIL_ROCK,
  badayer: BADAYER,
};

export const REGION_ORDER: RegionId[] = ['liwa', 'fossilrock', 'badayer'];

let active: RegionSpec = LIWA;

export function activeRegion(): RegionSpec {
  return active;
}

/**
 * Swaps the region. Callers own the teardown — every cached thing keyed on the
 * height field (terrain chunks, physics colliders, landmarks, scatter, baked
 * old tracks) is stale the instant this returns, and none of it is invalidated
 * from here because this module has no idea any of it exists.
 */
export function setActiveRegion(id: RegionId) {
  active = REGIONS[id] ?? LIWA;
}

export function isRegionId(v: unknown): v is RegionId {
  return typeof v === 'string' && v in REGIONS;
}
