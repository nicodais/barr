/**
 * What the player's truck *looks* like. Purely cosmetic by construction: the
 * collider, wheel positions and every tuning number live in VehicleTuning and
 * are shared by all four bodies, because §2 makes the driving feel the game's
 * core value and a garage that quietly changed handling would put that feel
 * behind a menu choice.
 *
 * Kept apart from vehicleMesh.ts so Settings can validate a saved config
 * without dragging Three.js into the settings path.
 */

export type BodyId = 'wagon' | 'pickup' | 'swb' | 'runner';
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
  /** Roof (or cage) rack with a strapped cargo box. */
  roofRack: boolean;
  /** Spare wheel — where it hangs depends on the body. */
  spare: boolean;
  lightBar: boolean;
  snorkel: boolean;
  sandLadders: boolean;
}

export interface BodyOption {
  id: BodyId;
  label: string;
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
  { id: 'wagon', label: 'Wagon' },
  { id: 'pickup', label: 'Pickup' },
  { id: 'swb', label: 'Short' },
  { id: 'runner', label: 'Runner' },
];

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
  roofRack: true,
  spare: true,
  lightBar: false,
  snorkel: false,
  sandLadders: false,
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

  for (const key of ['roofRack', 'spare', 'lightBar', 'snorkel', 'sandLadders'] as const) {
    if (typeof raw[key] === 'boolean') config[key] = raw[key];
  }
  return config;
}
