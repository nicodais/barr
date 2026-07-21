/**
 * The single input contract every control scheme feeds (§7). The vehicle
 * controller never learns whether a human is using keys, a stick, or a thumb.
 */
export interface VehicleInput {
  /** -1 = full left, +1 = full right */
  steer: number;
  /** 0..1 */
  throttle: number;
  /** 0..1 — service brake / reverse request */
  brake: number;
  /** 0..1 — locks the rears, for pivoting out of a bog */
  handbrake: number;
}

/** Free-look / orbit intent, kept separate so photo mode can reuse it later. */
export interface CameraInput {
  /** radians/sec of yaw the player is asking for */
  orbit: number;
  /** -1..1 pitch bias */
  pitch: number;
}

export interface InputSource {
  readonly id: string;
  /** True when this source produced meaningful input this frame. */
  poll(out: VehicleInput, cam: CameraInput, dt: number): boolean;
  dispose?(): void;
}

export function emptyInput(): VehicleInput {
  return { steer: 0, throttle: 0, brake: 0, handbrake: 0 };
}
