import type { CameraInput, InputSource, VehicleInput } from './types';

const STICK_DEADZONE = 0.12;
const TRIGGER_DEADZONE = 0.04;

/**
 * Standard Gamepad API mapping (§7): left stick steers, RT/LT are the pedals,
 * A/B mirror them so cheap pads without analog triggers still work.
 * Gamepads may appear on mobile too, so this source is always polled.
 */
export class GamepadSource implements InputSource {
  readonly id = 'gamepad';

  poll(out: VehicleInput, cam: CameraInput, _dt: number): boolean {
    const pad = firstConnectedPad();
    if (!pad) return false;

    const steer = deadzone(pad.axes[0] ?? 0, STICK_DEADZONE);
    // Analog triggers where available, face buttons as the fallback.
    const rt = buttonValue(pad, 7);
    const lt = buttonValue(pad, 6);
    const throttle = Math.max(deadzone(rt, TRIGGER_DEADZONE), buttonValue(pad, 0));
    const brake = Math.max(deadzone(lt, TRIGGER_DEADZONE), buttonValue(pad, 1));
    const handbrake = buttonValue(pad, 2);

    out.steer = steer;
    out.throttle = throttle;
    out.brake = brake;
    out.handbrake = handbrake;

    cam.orbit = deadzone(pad.axes[2] ?? 0, STICK_DEADZONE);
    cam.pitch = -deadzone(pad.axes[3] ?? 0, STICK_DEADZONE);

    return (
      Math.abs(steer) > 0 || throttle > 0 || brake > 0 || handbrake > 0 ||
      Math.abs(cam.orbit) > 0 || Math.abs(cam.pitch) > 0
    );
  }
}

export function firstConnectedPad(): Gamepad | null {
  if (!navigator.getGamepads) return null;
  for (const pad of navigator.getGamepads()) {
    if (pad && pad.connected) return pad;
  }
  return null;
}

function buttonValue(pad: Gamepad, index: number): number {
  const b = pad.buttons[index];
  if (!b) return 0;
  return typeof b.value === 'number' ? b.value : b.pressed ? 1 : 0;
}

function deadzone(v: number, dz: number): number {
  if (Math.abs(v) < dz) return 0;
  // Rescale so the response starts at zero just outside the deadzone.
  return Math.sign(v) * ((Math.abs(v) - dz) / (1 - dz));
}
