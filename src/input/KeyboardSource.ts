import type { CameraInput, InputSource, VehicleInput } from './types';

/**
 * Keyboard is a digital source feeding an analog contract, so everything is
 * slewed rather than snapped — instant full-lock steering is the single most
 * "go-kart" feeling mistake a keyboard scheme can make.
 */
const STEER_ATTACK = 3.2; // units/sec toward target
const STEER_RELEASE = 5.0; // units/sec back to centre
const PEDAL_ATTACK = 4.5;
const PEDAL_RELEASE = 6.0;

export class KeyboardSource implements InputSource {
  readonly id = 'keyboard';
  private keys = new Set<string>();
  /** Keys whose press edge hasn't been consumed yet this frame. */
  private pressed = new Set<string>();
  private steer = 0;
  private throttle = 0;
  private brake = 0;

  private onDown = (e: KeyboardEvent) => {
    // Let browser shortcuts through; only swallow the keys we actually drive with.
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    this.keys.add(e.code);
    // Record the edge separately. Polling `keys` once per frame silently drops
    // any tap shorter than a frame, which is easy to do on a discrete action
    // like reset. Ignore auto-repeat so a held key fires exactly once.
    if (!e.repeat) this.pressed.add(e.code);
    if (DRIVING_KEYS.has(e.code)) e.preventDefault();
  };
  private onUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };
  private onBlur = () => {
    this.keys.clear();
    this.pressed.clear();
  };

  constructor(target: Window = window) {
    target.addEventListener('keydown', this.onDown);
    target.addEventListener('keyup', this.onUp);
    target.addEventListener('blur', this.onBlur);
  }

  poll(out: VehicleInput, cam: CameraInput, dt: number): boolean {
    const k = this.keys;
    const left = k.has('KeyA') || k.has('ArrowLeft');
    const right = k.has('KeyD') || k.has('ArrowRight');
    const fwd = k.has('KeyW') || k.has('ArrowUp');
    const back = k.has('KeyS') || k.has('ArrowDown');
    const hand = k.has('Space');

    const steerTarget = (left ? -1 : 0) + (right ? 1 : 0);
    this.steer = slew(this.steer, steerTarget, dt, steerTarget === 0 ? STEER_RELEASE : STEER_ATTACK);
    this.throttle = slew(this.throttle, fwd ? 1 : 0, dt, fwd ? PEDAL_ATTACK : PEDAL_RELEASE);
    this.brake = slew(this.brake, back ? 1 : 0, dt, back ? PEDAL_ATTACK : PEDAL_RELEASE);

    out.steer = this.steer;
    out.throttle = this.throttle;
    out.brake = this.brake;
    out.handbrake = hand ? 1 : 0;

    cam.orbit = (k.has('KeyQ') ? -1 : 0) + (k.has('KeyE') ? 1 : 0);
    cam.pitch = 0;

    return left || right || fwd || back || hand;
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  /** True once per physical press, however briefly the key was held. */
  consumePress(code: string): boolean {
    return this.pressed.delete(code);
  }

  /** Drops press edges nobody asked about, so they can't fire later. */
  endFrame() {
    this.pressed.clear();
  }

  dispose() {
    window.removeEventListener('keydown', this.onDown);
    window.removeEventListener('keyup', this.onUp);
    window.removeEventListener('blur', this.onBlur);
  }
}

const DRIVING_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space',
]);

function slew(current: number, target: number, dt: number, rate: number): number {
  const delta = target - current;
  const step = rate * dt;
  if (Math.abs(delta) <= step) return target;
  return current + Math.sign(delta) * step;
}
