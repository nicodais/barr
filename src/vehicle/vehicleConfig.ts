/**
 * What the player's truck is, and how it drives.
 *
 * Paint and wheels are cosmetic; the body is not. Each one carries real
 * handling overrides (BODY_TUNING below), because the point of putting stats on
 * the picker is that the choice has consequences.
 *
 * What every body *does* share is its footprint: the collider half-extents,
 * wheel positions, track and wheelbase are fixed in VehicleTuning, built once
 * in the Vehicle constructor and never rebuilt when the body changes. So a body
 * is free to look like anything that fits a 1.84 x 4.3m box on a 2.9m
 * wheelbase, and is not free to be a different size.
 *
 * Kept apart from vehicleMesh.ts so Settings can validate a saved config
 * without dragging Three.js into the settings path.
 */

export type BodyId = 'wagon' | 'pickup' | 'gwagon' | 'singlecab' | 'softtop' | 'buggy';
export type WheelStyleId = 'steel' | 'alloy' | 'beadlock';
export type PaintId =
  | 'safari'
  | 'wadi'
  | 'indigo'
  | 'bone'
  | 'oxide'
  | 'rose'
  | 'slate'
  | 'ink';

export interface VehicleConfig {
  body: BodyId;
  paint: PaintId;
  wheels: WheelStyleId;
}

export interface BodyOption {
  id: BodyId;
  label: string;
  /** One line for the selection screen — what it is and how it drives. */
  blurb: string;
  /** Display bars, 0..1. Derived from the tuning below, not invented. */
  stats: { speed: number; grip: number; weight: number; agility: number };
}

export interface PaintOption {
  id: PaintId;
  label: string;
  color: number;
}

export interface WheelOption {
  id: WheelStyleId;
  label: string;
}

export const BODY_OPTIONS: BodyOption[] = [
  {
    id: 'wagon',
    label: 'Safari Wagon',
    blurb: 'The reference. Nothing it does badly, nothing it does first.',
    stats: { speed: 0.6, grip: 0.62, weight: 0.6, agility: 0.58 },
  },
  {
    id: 'pickup',
    label: 'Full-Size Pickup',
    blurb: 'Two and a half tonnes of momentum. Climbs anything, stops slowly.',
    stats: { speed: 0.52, grip: 0.72, weight: 0.95, agility: 0.3 },
  },
  {
    id: 'gwagon',
    label: 'Box Wagon',
    blurb: 'Tall, square and grippy. Superb on a ridge, nervous across one.',
    stats: { speed: 0.58, grip: 0.82, weight: 0.62, agility: 0.55 },
  },
  {
    id: 'singlecab',
    // What these are actually called across the Gulf, and it names the one
    // thing separating it from the crew cab above — no badge required (§11).
    label: 'Single Cab',
    blurb: 'Leaf-sprung and slow. Grinds up whatever you point it at.',
    stats: { speed: 0.42, grip: 0.8, weight: 0.66, agility: 0.46 },
  },
  {
    id: 'softtop',
    label: 'Soft Top',
    blurb: 'Roof off, doors off. Wonderful right up until you cross a slope.',
    stats: { speed: 0.66, grip: 0.7, weight: 0.38, agility: 0.8 },
  },
  {
    id: 'buggy',
    label: 'Dune Buggy',
    blurb: 'Half a tonne. Floats over soft sand and changes its mind instantly.',
    stats: { speed: 0.92, grip: 0.42, weight: 0.12, agility: 0.95 },
  },
];

/**
 * How each body actually drives.
 *
 * These are real overrides on the tuning object, not a spec sheet next to an
 * identical car — the earlier version of this feature kept them cosmetic to
 * protect the driving feel, and the point of stats is that the choice has
 * consequences. Every number below is a deliberate trade, and the wagon stays
 * exactly at the tuned baseline so there is always one honest reference to
 * judge the others against.
 *
 * Deliberately untouched everywhere: `gravity` (every force in the tuning is
 * scaled off it, so a per-body value would silently rescale the whole model)
 * and the rollover recovery, which stays damage-free and identical for all of
 * them (§2).
 *
 * Every value here is **absolute**, replacing the baseline outright rather than
 * multiplying it. That is worth stating because getting it wrong is invisible:
 * `sinkDrag` has a baseline of ~1100 and shipped here as 1.35 and 0.35, which
 * read perfectly well as "a bit more" and "much less" and in fact set both
 * bodies to no sink drag at all. The pickup and the buggy — the two whose
 * blurbs promise the most *different* behaviour in soft sand — were behaving
 * identically in it. Both are stated in force units below.
 */
export const BODY_TUNING: Record<BodyId, Record<string, number>> = {
  // The baseline. Empty on purpose.
  wagon: {},

  // Heavy: hard to stop, hard to turn, and almost impossible to bog because it
  // carries so much momentum into a climb. The high COM is the cost — this is
  // the easiest one to put on its roof across a slope.
  pickup: {
    mass: 2650,
    comHeight: 0.40,
    rollInertia: 1650,
    pitchInertia: 5400,
    yawInertia: 3600,
    engineForce: 3900,
    topSpeed: 30,
    brakeForce: 1900,
    steerRate: 2.4,
    maxSteerAngle: 0.50,
    suspensionStiffness: 26,
    // Absolute, against a ~1100 baseline: it is heavy and it does sink, and
    // what stops it bogging is the momentum, not floating over the top.
    sinkDrag: 1480,
    climbBleed: 0.86,
  },

  // Short, tall and grippy. Best mechanical traction of the six, but the tall
  // body and high COM mean a sidehill is genuinely tense.
  gwagon: {
    mass: 2250,
    comHeight: 0.42,
    rollInertia: 1150,
    engineForce: 3500,
    topSpeed: 31,
    hardpackGrip: 1.18,
    sandGrip: 1.16,
    hardpackSideGrip: 1.2,
    sandSideGrip: 1.18,
    maxSteerAngle: 0.60,
  },

  // The working truck. Leaf-sprung, narrow-tyred and geared low: it is the
  // slowest thing here by a distance and the least comfortable over chop, and
  // it will crawl up a face that has already stalled two of the others.
  singlecab: {
    mass: 2000,
    comHeight: 0.34,
    rollInertia: 1150,
    pitchInertia: 4500,
    yawInertia: 2900,
    engineForce: 3250,
    topSpeed: 26,
    brakeForce: 1950,
    steerRate: 3.0,
    maxSteerAngle: 0.55,
    // Leaf springs: the stiffest and shortest-travel setup of the six. It
    // skitters over corrugations the coil-sprung bodies absorb, and lands hard
    // — which is most of what separates it from the wagon by feel.
    suspensionStiffness: 38,
    suspensionTravel: 0.24,
    suspensionCompression: 4.4,
    suspensionRelaxation: 5.6,
    hardpackGrip: 1.5,
    sandGrip: 0.82,
    // Narrow tyres on a loaded truck dig in where the wide-tyred bodies float.
    sinkDrag: 1500,
    // The trade, and the reason to pick it: low gearing barely notices a climb.
    climbBleed: 0.6,
  },

  // Open, light and sat up high. The only body here whose grip and whose
  // stability point in opposite directions: it holds a line across a face
  // better than anything except the box wagon, and having held it, tips. That
  // tension is the whole reason to drive it, and it costs nothing (§2 — a
  // rollover is a beat, never a penalty).
  softtop: {
    mass: 1680,
    // Highest of the six. No roof to lower the mass, and you sit on the tub
    // rather than down in it.
    comHeight: 0.46,
    rollInertia: 880,
    pitchInertia: 3100,
    yawInertia: 2000,
    engineForce: 3300,
    topSpeed: 34,
    brakeForce: 2100,
    steerRate: 4.0,
    maxSteerAngle: 0.66,
    suspensionRest: 0.52,
    suspensionTravel: 0.44,
    suspensionStiffness: 20,
    hardpackGrip: 1.24,
    sandGrip: 0.95,
    // Above baseline, deliberately. Grip is what lets it get far enough over
    // to be in trouble; a body that just slid away would never tip at all.
    hardpackSideGrip: 0.74,
    sandSideGrip: 0.42,
    sinkDrag: 820,
    climbBleed: 0.7,
  },

  // Light enough to stay on top of sand that swallows the others, and low
  // enough to be very hard to roll. Pays for it in grip: it slides everywhere,
  // which is the fun of it.
  buggy: {
    mass: 720,
    comHeight: 0.22,
    rollInertia: 420,
    pitchInertia: 1500,
    yawInertia: 900,
    engineForce: 2300,
    topSpeed: 39,
    brakeForce: 1500,
    steerRate: 4.4,
    maxSteerAngle: 0.72,
    suspensionRest: 0.56,
    suspensionTravel: 0.48,
    suspensionStiffness: 15,
    hardpackGrip: 0.86,
    sandGrip: 0.9,
    hardpackSideGrip: 0.82,
    sandSideGrip: 0.86,
    // The signature: it barely sinks, so soft slip faces that stall a truck are
    // just a surface to slide across. A third of the baseline, not a thousandth.
    sinkDrag: 385,
    climbBleed: 0.55,
    yawAssist: 1.35,
  },
};

/**
 * Eight swatches, checked in-engine against red-orange sand at a low sun rather
 * than picked as hex values in isolation. Two rules came out of that pass:
 *
 * - Anything in the sand's own hue band (tan, mustard, burnt orange) loses its
 *   silhouette entirely at chase-camera distance — the truck becomes a shape
 *   you infer from its shadow. So the warm end here is pushed either much
 *   darker (oxide) or much pinker (rose) than the ground ever gets.
 * - Near-white reads as a hole punched in the frame under a strong sun, the
 *   same failure the chrome colour was muted for, so 'bone' is knocked well
 *   down from white and carries a warm tint.
 */
export const PAINT_OPTIONS: PaintOption[] = [
  { id: 'safari', label: 'Safari Green', color: 0x4f8b60 },
  { id: 'wadi', label: 'Wadi Teal', color: 0x2c6b70 },
  { id: 'indigo', label: 'Night Indigo', color: 0x3a527f },
  { id: 'bone', label: 'Bone', color: 0xc0b499 },
  { id: 'oxide', label: 'Oxide Red', color: 0x94382c },
  { id: 'rose', label: 'Dusty Rose', color: 0xa76473 },
  { id: 'slate', label: 'Slate', color: 0x676663 },
  { id: 'ink', label: 'Desert Ink', color: 0x3c414a },
];

export const WHEEL_OPTIONS: WheelOption[] = [
  { id: 'steel', label: 'Steel' },
  { id: 'alloy', label: 'Alloy' },
  { id: 'beadlock', label: 'Beadlock' },
];

export const DEFAULT_VEHICLE: VehicleConfig = {
  body: 'wagon',
  paint: 'safari',
  wheels: 'steel',
};

export function paintColor(id: PaintId): number {
  return (PAINT_OPTIONS.find((p) => p.id === id) ?? PAINT_OPTIONS[0]).color;
}

/**
 * Accepts a stored blob one key at a time. A config that half-loads is fine —
 * every field has a working default — but a config that loads a body id we no
 * longer build would leave the player with an invisible truck, so unknown
 * values are dropped rather than trusted.
 */
export function sanitizeVehicleConfig(saved: unknown): VehicleConfig {
  const config: VehicleConfig = { ...DEFAULT_VEHICLE };
  if (!saved || typeof saved !== 'object') return config;
  const raw = saved as Record<string, unknown>;

  if (BODY_OPTIONS.some((o) => o.id === raw.body)) config.body = raw.body as BodyId;
  if (PAINT_OPTIONS.some((o) => o.id === raw.paint)) config.paint = raw.paint as PaintId;
  if (WHEEL_OPTIONS.some((o) => o.id === raw.wheels)) config.wheels = raw.wheels as WheelStyleId;

  return config;
}
