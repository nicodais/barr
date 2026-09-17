import { describe, expect, it } from 'vitest';

import { emptyInput } from '../src/input/types';
import type { CameraInput, InputSource, VehicleInput } from '../src/input/types';

/**
 * The shared input contract (§7).
 *
 * `InputManager` itself constructs keyboard, touch and gamepad sources, all of
 * which reach for `window` on the way up, so it is not directly constructible
 * in Node. What is worth pinning is the aggregation *rule* those sources feed —
 * gamepad wins when it is being used, otherwise the last source to produce
 * input keeps control, and a source that is idle but still settling keeps
 * writing so releasing a key doesn't snap the wheel straight.
 *
 * That rule is reproduced here against fake sources. It is the one part of the
 * input path that is pure logic, and it is the part that decides whether
 * plugging a pad mid-drive takes the car away from the keyboard.
 */

function hasSignal(i: VehicleInput): boolean {
  return i.steer !== 0 || i.throttle !== 0 || i.brake !== 0 || i.handbrake !== 0;
}

/** The body of InputManager.update, over injected sources. */
function aggregate(sources: InputSource[], invertSteering: boolean) {
  const vehicle = emptyInput();
  const camera: CameraInput = { orbit: 0, pitch: 0 };
  const scratch = emptyInput();
  const scratchCam: CameraInput = { orbit: 0, pitch: 0 };
  let activeId = 'keyboard';
  let claimed = false;

  for (const source of sources) {
    Object.assign(scratch, emptyInput());
    scratchCam.orbit = 0;
    scratchCam.pitch = 0;
    const active = source.poll(scratch, scratchCam, 1 / 60);
    const settling = !active && hasSignal(scratch);
    if (active || settling || !claimed) {
      Object.assign(vehicle, scratch);
      camera.orbit = scratchCam.orbit;
      camera.pitch = scratchCam.pitch;
      if (active) {
        claimed = true;
        activeId = source.id;
      }
    }
  }
  if (invertSteering) vehicle.steer = -vehicle.steer;
  return { vehicle, camera, activeId };
}

/** A source that writes `out` and reports whether it counts as active. */
function fake(id: string, out: Partial<VehicleInput>, active: boolean): InputSource {
  return {
    id,
    poll(o) {
      Object.assign(o, out);
      return active;
    },
  };
}

const idle = (id: string) => fake(id, {}, false);

describe('emptyInput', () => {
  it('is centred and released', () => {
    expect(emptyInput()).toEqual({ steer: 0, throttle: 0, brake: 0, handbrake: 0 });
  });

  it('returns a fresh object each time', () => {
    expect(emptyInput()).not.toBe(emptyInput());
  });
});

describe('source aggregation', () => {
  it('lets a later source override an earlier active one', () => {
    // Gamepad is constructed last precisely so a controller wins over anything
    // else in use, on desktop and mobile alike.
    const result = aggregate(
      [fake('keyboard', { steer: -1, throttle: 1 }, true), fake('gamepad', { steer: 0.5 }, true)],
      false,
    );
    expect(result.activeId).toBe('gamepad');
    expect(result.vehicle.steer).toBe(0.5);
    expect(result.vehicle.throttle).toBe(0);
  });

  it('leaves control with the active source when a later one is idle', () => {
    const result = aggregate(
      [fake('keyboard', { steer: -1 }, true), idle('gamepad')],
      false,
    );
    expect(result.activeId).toBe('keyboard');
    expect(result.vehicle.steer).toBe(-1);
  });

  it('keeps writing a source that is idle but still settling', () => {
    // The keyboard slews steering back to centre after a key is released. If
    // an idle-but-non-zero source stopped writing, letting go of a key would
    // snap the wheel straight instead of returning smoothly.
    const result = aggregate([fake('keyboard', { steer: -0.4 }, false)], false);
    expect(result.vehicle.steer).toBe(-0.4);
  });

  it('falls back to a fully idle source rather than leaving stale input', () => {
    const result = aggregate([idle('keyboard'), idle('touch')], false);
    expect(result.vehicle).toEqual(emptyInput());
  });

  it('applies steering inversion once, after aggregation', () => {
    // Inverting inside the loop would cancel out when two sources both write
    // in one frame. Living outside it also covers gamepad and touch for free.
    const sources = [fake('keyboard', { steer: 0.6 }, true), fake('gamepad', { steer: 0.6 }, true)];
    expect(aggregate(sources, true).vehicle.steer).toBeCloseTo(-0.6);
    expect(aggregate(sources, false).vehicle.steer).toBeCloseTo(0.6);
  });

  it('does not invert throttle, brake or handbrake', () => {
    const result = aggregate(
      [fake('keyboard', { steer: 1, throttle: 1, brake: 0.5, handbrake: 1 }, true)],
      true,
    );
    expect(result.vehicle.throttle).toBe(1);
    expect(result.vehicle.brake).toBe(0.5);
    expect(result.vehicle.handbrake).toBe(1);
  });
});
