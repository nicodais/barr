import type { GameSettings } from '../settings/Settings';
import { GamepadSource } from './GamepadSource';
import { KeyboardSource } from './KeyboardSource';
import { TouchSource } from './TouchSource';
import type { CameraInput, InputSource, VehicleInput } from './types';
import { emptyInput } from './types';

/**
 * Aggregates every available source into one `VehicleInput` (§7). Gamepad wins
 * whenever it is actually being used, otherwise the last source to produce
 * input keeps control — so plugging a pad mid-drive just works, and letting go
 * of it hands the car back to the keyboard.
 */
export class InputManager {
  readonly vehicle: VehicleInput = emptyInput();
  readonly camera: CameraInput = { orbit: 0, pitch: 0 };

  readonly keyboard = new KeyboardSource();
  private sources: InputSource[];
  private scratch = emptyInput();
  private scratchCam: CameraInput = { orbit: 0, pitch: 0 };
  private _activeId = 'keyboard';

  readonly touch = new TouchSource();

  constructor(private settings: GameSettings) {
    // Order matters: later sources override earlier ones when both are active.
    // Gamepad is last so a controller wins over anything else it's used with,
    // on desktop and mobile alike (§7).
    this.sources = [this.keyboard, this.touch, new GamepadSource()];
  }

  get activeId(): string {
    return this._activeId;
  }

  update(dt: number) {
    let claimed = false;
    for (const source of this.sources) {
      this.scratch.steer = 0;
      this.scratch.throttle = 0;
      this.scratch.brake = 0;
      this.scratch.handbrake = 0;
      this.scratchCam.orbit = 0;
      this.scratchCam.pitch = 0;

      const active = source.poll(this.scratch, this.scratchCam, dt);
      // A source that is idle but still settling (keyboard slew back to centre)
      // must keep writing, or releasing a key would snap the wheel straight.
      const settling = !active && hasSignal(this.scratch);
      if (active || settling || !claimed) {
        copyInput(this.scratch, this.vehicle);
        this.camera.orbit = this.scratchCam.orbit;
        this.camera.pitch = this.scratchCam.pitch;
        if (active) {
          claimed = true;
          this._activeId = source.id;
        }
      }
    }

    // Applied once, after aggregation rather than per source: two sources can
    // both write in a frame, and inverting inside the loop would cancel out.
    // Living here means it covers gamepad and the phase 5 touch schemes too,
    // and the vehicle controller stays control-scheme-agnostic (§7).
    if (this.settings.invertSteering) {
      this.vehicle.steer = -this.vehicle.steer;
    }
  }

  dispose() {
    for (const s of this.sources) s.dispose?.();
  }
}

function hasSignal(i: VehicleInput): boolean {
  return i.steer !== 0 || i.throttle !== 0 || i.brake !== 0 || i.handbrake !== 0;
}

function copyInput(from: VehicleInput, to: VehicleInput) {
  to.steer = from.steer;
  to.throttle = from.throttle;
  to.brake = from.brake;
  to.handbrake = from.handbrake;
}
