import type { CameraInput, InputSource, VehicleInput } from './types';

/**
 * Touch control schemes (§7). All three feed the same VehicleInput the keyboard
 * and gamepad do, so the vehicle controller never learns which is in use.
 *
 * The DOM is built once and shown/hidden per scheme rather than rebuilt, and
 * every widget tracks touches by `identifier` — sharing a screen between a
 * steering thumb and a throttle thumb means multi-touch is the normal case, not
 * an edge case, and index-based tracking breaks the moment a finger lifts.
 */
export type TouchScheme = 'joystick' | 'wheel' | 'tilt';
export type Handedness = 'left' | 'right';
export type JoystickPosition = 'left' | 'middle' | 'right';

const STICK_RADIUS = 62;
const WHEEL_MAX_ANGLE = Math.PI * 0.62;

export class TouchSource implements InputSource {
  readonly id = 'touch';
  readonly element: HTMLElement;

  private scheme: TouchScheme = 'joystick';
  private handedness: Handedness = 'left';
  private joystickPosition: JoystickPosition = 'left';

  private steer = 0;
  private throttle = 0;
  private brake = 0;
  private handbrake = 0;
  private active = false;

  private stickZone: HTMLElement;
  private stickBase: HTMLElement;
  private stickKnob: HTMLElement;
  private wheel: HTMLElement;
  private pedals: HTMLElement;
  private throttlePad: HTMLElement;
  private brakePad: HTMLElement;
  private actions: HTMLElement;
  private handPad: HTMLElement;

  private stickTouch: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private wheelTouch: number | null = null;
  private wheelStartAngle = 0;
  private wheelAngle = 0;
  private throttleTouch: number | null = null;
  private brakeTouch: number | null = null;
  private handTouch: number | null = null;

  /** Set by Game. The two one-shot buttons aren't input axes — they're the
   *  touch equivalent of R and P, which had no equivalent at all. */
  private onReset: (() => void) | null = null;
  private onPhoto: (() => void) | null = null;

  private tiltZero: number | null = null;
  private tiltSteer = 0;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'touch-controls';
    this.element.hidden = true;

    this.stickZone = div('touch-stick-zone');
    this.stickBase = div('touch-stick-base');
    this.stickKnob = div('touch-stick-knob');
    this.stickBase.appendChild(this.stickKnob);
    this.stickZone.appendChild(this.stickBase);

    this.wheel = div('touch-wheel');
    this.wheel.innerHTML =
      '<svg viewBox="0 0 100 100" aria-hidden="true">' +
      '<circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" stroke-width="7"/>' +
      '<line x1="50" y1="8" x2="50" y2="26" stroke="currentColor" stroke-width="7"/>' +
      '<line x1="12" y1="62" x2="50" y2="50" stroke="currentColor" stroke-width="6"/>' +
      '<line x1="88" y1="62" x2="50" y2="50" stroke="currentColor" stroke-width="6"/>' +
      '</svg>';

    this.pedals = div('touch-pedals');
    this.throttlePad = div('touch-pedal touch-pedal-go');
    this.throttlePad.textContent = 'GO';
    this.brakePad = div('touch-pedal touch-pedal-stop');
    this.brakePad.textContent = 'STOP';
    this.pedals.append(this.brakePad, this.throttlePad);

    // Opposite thumb from the stick. Everything here was keyboard-only until
    // now: Space, R and P have no touch equivalent, which quietly made the
    // handbrake, the unstick and the whole of photo mode desktop features.
    this.actions = div('touch-actions');
    this.handPad = button('touch-action touch-action-hand', 'HOLD', 'Handbrake');
    const resetPad = button('touch-action', '↺', 'Reset the truck');
    const photoPad = button('touch-action', '◉', 'Photo mode');
    resetPad.addEventListener('click', () => this.onReset?.());
    photoPad.addEventListener('click', () => this.onPhoto?.());
    this.actions.append(photoPad, resetPad, this.handPad);

    this.element.append(this.stickZone, this.wheel, this.pedals, this.actions);
    this.bind();
    this.applyScheme();
  }

  setActions(onReset: () => void, onPhoto: () => void) {
    this.onReset = onReset;
    this.onPhoto = onPhoto;
  }

  setScheme(scheme: TouchScheme) {
    this.scheme = scheme;
    this.resetState();
    this.applyScheme();
    if (scheme === 'tilt') this.enableTilt();
  }

  setHandedness(hand: Handedness) {
    this.handedness = hand;
    this.applyScheme();
  }

  setJoystickPosition(pos: JoystickPosition) {
    this.joystickPosition = pos;
    this.applyScheme();
  }

  show() {
    this.element.hidden = false;
  }

  poll(out: VehicleInput, cam: CameraInput, _dt: number): boolean {
    let steer = this.steer;
    if (this.scheme === 'tilt') steer = this.tiltSteer;

    out.steer = clamp(steer, -1, 1);
    out.throttle = clamp(this.throttle, 0, 1);
    out.brake = clamp(this.brake, 0, 1);
    out.handbrake = this.handbrake;
    cam.orbit = 0;
    cam.pitch = 0;

    return this.active || Math.abs(steer) > 0.02 || this.throttle > 0 ||
      this.brake > 0 || this.handbrake > 0;
  }

  private applyScheme() {
    const joystick = this.scheme === 'joystick';
    this.stickZone.hidden = !joystick;
    this.wheel.hidden = this.scheme !== 'wheel';
    this.pedals.hidden = joystick;
    // The stick is the thumb that never lifts, so the actions go to the other
    // one. Middle sits under neither thumb, so they default right.
    this.actions.classList.toggle(
      'touch-actions-left',
      joystick && this.joystickPosition === 'right',
    );

    this.element.classList.toggle('touch-right-handed', this.handedness === 'right');
    // The thumbstick's position is its own setting (left/middle/right), separate
    // from handedness — which now only decides which side the wheel/tilt pedals sit.
    this.element.classList.toggle('touch-stick-left', this.joystickPosition === 'left');
    this.element.classList.toggle('touch-stick-middle', this.joystickPosition === 'middle');
    this.element.classList.toggle('touch-stick-right', this.joystickPosition === 'right');
    this.wheel.style.transform = 'rotate(0rad)';
  }

  private resetState() {
    this.steer = 0;
    this.throttle = 0;
    this.brake = 0;
    this.handbrake = 0;
    this.wheelAngle = 0;
    this.stickTouch = null;
    this.wheelTouch = null;
    this.throttleTouch = null;
    this.brakeTouch = null;
    this.handTouch = null;
    this.handPad.classList.remove('touch-pedal-down');
    this.active = false;
    this.stickKnob.style.transform = 'translate(-50%, -50%)';
  }

  private bind() {
    // Non-passive so the browser doesn't scroll or rubber-band the page while
    // a thumb is on the throttle.
    const opts: AddEventListenerOptions = { passive: false };

    this.stickZone.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      this.stickTouch = t.identifier;
      const rect = this.stickBase.getBoundingClientRect();
      this.stickOrigin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      this.active = true;
      e.preventDefault();
    }, opts);

    this.wheel.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      this.wheelTouch = t.identifier;
      this.wheelStartAngle = this.angleTo(this.wheel, t) - this.wheelAngle;
      this.active = true;
      e.preventDefault();
    }, opts);

    const pad = (el: HTMLElement, set: (id: number | null) => void) => {
      el.addEventListener('touchstart', (e) => {
        set(e.changedTouches[0].identifier);
        this.active = true;
        el.classList.add('touch-pedal-down');
        e.preventDefault();
      }, opts);
    };
    pad(this.throttlePad, (id) => { this.throttleTouch = id; this.throttle = 1; });
    pad(this.brakePad, (id) => { this.brakeTouch = id; this.brake = 1; });
    pad(this.handPad, (id) => { this.handTouch = id; this.handbrake = 1; });

    window.addEventListener('touchmove', (e) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === this.stickTouch) {
          const dx = t.clientX - this.stickOrigin.x;
          const dy = t.clientY - this.stickOrigin.y;
          const nx = clamp(dx / STICK_RADIUS, -1, 1);
          const ny = clamp(dy / STICK_RADIUS, -1, 1);
          this.steer = nx;
          // Up is forward, down is brake/reverse — a single stick does both (§7).
          this.throttle = ny < 0 ? -ny : 0;
          this.brake = ny > 0 ? ny : 0;
          this.stickKnob.style.transform =
            `translate(calc(-50% + ${nx * STICK_RADIUS}px), calc(-50% + ${ny * STICK_RADIUS}px))`;
          e.preventDefault();
        } else if (t.identifier === this.wheelTouch) {
          const raw = this.angleTo(this.wheel, t) - this.wheelStartAngle;
          this.wheelAngle = clamp(raw, -WHEEL_MAX_ANGLE, WHEEL_MAX_ANGLE);
          this.steer = this.wheelAngle / WHEEL_MAX_ANGLE;
          this.wheel.style.transform = `rotate(${this.wheelAngle}rad)`;
          e.preventDefault();
        }
      }
    }, opts);

    const end = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === this.stickTouch) {
          this.stickTouch = null;
          this.steer = 0;
          this.throttle = 0;
          this.brake = 0;
          this.stickKnob.style.transform = 'translate(-50%, -50%)';
        }
        if (t.identifier === this.wheelTouch) {
          this.wheelTouch = null;
          // The wheel self-centres, like a real one letting go.
          this.wheelAngle = 0;
          this.steer = 0;
          this.wheel.style.transform = 'rotate(0rad)';
        }
        if (t.identifier === this.throttleTouch) {
          this.throttleTouch = null;
          this.throttle = 0;
          this.throttlePad.classList.remove('touch-pedal-down');
        }
        if (t.identifier === this.brakeTouch) {
          this.brakeTouch = null;
          this.brake = 0;
          this.brakePad.classList.remove('touch-pedal-down');
        }
        if (t.identifier === this.handTouch) {
          this.handTouch = null;
          this.handbrake = 0;
          this.handPad.classList.remove('touch-pedal-down');
        }
      }
      this.active =
        this.stickTouch !== null || this.wheelTouch !== null ||
        this.throttleTouch !== null || this.brakeTouch !== null ||
        this.handTouch !== null;
    };
    window.addEventListener('touchend', end, opts);
    window.addEventListener('touchcancel', end, opts);
  }

  private angleTo(el: HTMLElement, t: Touch): number {
    const r = el.getBoundingClientRect();
    return Math.atan2(t.clientY - (r.top + r.height / 2), t.clientX - (r.left + r.width / 2));
  }

  /**
   * Tilt steering. The first reading becomes the neutral point rather than
   * assuming the phone is held flat — people drive slouched, and calibrating to
   * however they're actually holding it is the difference between usable and
   * infuriating.
   */
  private enableTilt() {
    const attach = () => {
      window.addEventListener('deviceorientation', (e) => {
        if (this.scheme !== 'tilt' || e.gamma === null) return;
        if (this.tiltZero === null) this.tiltZero = e.gamma;
        const delta = e.gamma - this.tiltZero;
        this.tiltSteer = clamp(delta / 26, -1, 1);
      });
    };

    // iOS 13+ gates the sensor behind an explicit permission prompt, which must
    // be requested from a user gesture.
    const anyOrientation = DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<PermissionState>;
    };
    if (typeof anyOrientation.requestPermission === 'function') {
      anyOrientation.requestPermission().then((state) => {
        if (state === 'granted') attach();
      }).catch(() => { /* denied; the pedals still work */ });
    } else {
      attach();
    }
  }

  /** Re-zeroes tilt to however the device is being held right now. */
  recalibrateTilt() {
    this.tiltZero = null;
  }
}

function div(className: string): HTMLElement {
  const el = document.createElement('div');
  el.className = className;
  return el;
}

function button(className: string, label: string, aria: string): HTMLElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = className;
  el.textContent = label;
  el.setAttribute('aria-label', aria);
  return el;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
