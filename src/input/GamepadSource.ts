import type { CameraInput, InputSource, VehicleInput } from './types';

/**
 * Controllers, with the Xbox pad as the reference (§7).
 *
 * ## What "an Xbox controller over Bluetooth" actually looks like to a page
 *
 * Usually exactly like one on a cable: Chrome, Edge and Safari — and Firefox on
 * Windows and macOS — recognise it and hand it over in the Gamepad API's
 * `standard` mapping, where the left stick is axes 0/1, the triggers are
 * buttons 6/7 with an analog `value`, and A/B/X/Y are buttons 0–3.
 *
 * The cases that are *not* like that are the ones this file exists for:
 *
 *  - **Unmapped layouts.** Where the browser does not recognise the pad —
 *    Firefox on Linux is the common one — `mapping` is the empty string and
 *    the raw driver order comes through instead: the triggers are *axes* that
 *    rest at -1 rather than buttons that rest at 0, the right stick has moved,
 *    and the D-pad is a hat on two more axes. Read with the standard indices,
 *    that is a truck that drives itself at half throttle the moment the pad
 *    connects. Two driver orders exist for the same controller (see `LAYOUTS`)
 *    and the pad does not say which it is, so it is worked out from which axes
 *    sit at -1 when nobody is touching them.
 *  - **Triggers that have not reported yet.** An axis trigger reads exactly 0
 *    until it is first moved, which is indistinguishable from "half pressed".
 *    A trigger is therefore ignored until it has been seen to move.
 *  - **Nothing at all until a button is pressed.** Browsers hide every pad
 *    from the page until the player presses something on it, so a paired
 *    controller is invisible at load. That is why the connect toast exists and
 *    why nothing here treats "no pad" as "no pad is coming".
 *  - **Stick drift.** A wireless pad that has seen some use does not centre at
 *    0, so the dead zone is on the stick as a whole rather than per axis, and
 *    is rescaled so the response still starts from nothing at its edge.
 */

export type PadButton =
  | 'a' | 'b' | 'x' | 'y'
  | 'lb' | 'rb'
  | 'view' | 'menu'
  | 'up' | 'down' | 'left' | 'right';

const STICK_DEADZONE = 0.14;
const TRIGGER_DEADZONE = 0.05;
/**
 * Steering response. A thumbstick has perhaps a centimetre of throw to cover
 * the same lock a keyboard slews through in a third of a second, so the middle
 * of it is softened: small corrections at speed stay small, and full lock is
 * still at the stop.
 */
const STEER_EXPO = 1.55;
/** How far a stick has to be pushed to count as a D-pad press in a menu. */
const STICK_FLICK = 0.6;
/** Frames an axis must sit at its stop before it is believed to be a trigger. */
const REST_FRAMES = 20;

interface Layout {
  /** Where each control lives. Triggers are button indices or axis indices. */
  rightStick: [number, number];
  triggers: { kind: 'button' | 'axis'; left: number; right: number };
  buttons: Partial<Record<PadButton, number>>;
  /** D-pad as a hat: [x axis, y axis]. Absent when it is four buttons. */
  hat?: [number, number];
}

const STANDARD: Layout = {
  rightStick: [2, 3],
  triggers: { kind: 'button', left: 6, right: 7 },
  buttons: {
    a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, view: 8, menu: 9,
    up: 12, down: 13, left: 14, right: 15,
  },
};

/**
 * The two raw orders an Xbox pad arrives in when the browser has not mapped it.
 *
 * `xpad` is what the Linux `xpad`/`xpadneo` drivers report and is by far the
 * commoner. `hid` is the generic Bluetooth HID order older controller firmware
 * produces, with the sticks together and the triggers after them — and its
 * buttons follow the Android key order, which leaves gaps where C and Z would be.
 */
const LAYOUTS: Record<'xpad' | 'hid', Layout> = {
  xpad: {
    rightStick: [3, 4],
    triggers: { kind: 'axis', left: 2, right: 5 },
    buttons: { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, view: 6, menu: 7 },
    hat: [6, 7],
  },
  hid: {
    rightStick: [2, 3],
    triggers: { kind: 'axis', left: 5, right: 4 },
    buttons: { a: 0, b: 1, x: 3, y: 4, lb: 6, rb: 7, view: 10, menu: 11 },
    hat: [6, 7],
  },
};

/** What is known about one physical pad, kept across frames. */
interface PadMemory {
  layout: Layout;
  /** Still guessing between the raw layouts. */
  undecided: boolean;
  /** Per axis: has it ever read anything but exactly 0. */
  moved: boolean[];
  /** Per axis: consecutive frames spent at the -1 stop. */
  resting: number[];
  /** Buttons held on the previous poll, for edges. */
  held: Set<PadButton>;
}

const ALL_BUTTONS: PadButton[] = [
  'a', 'b', 'x', 'y', 'lb', 'rb', 'view', 'menu', 'up', 'down', 'left', 'right',
];

export interface PadSnapshot {
  steer: number;
  throttle: number;
  brake: number;
  handbrake: number;
  orbit: number;
  pitch: number;
  /** Every logical button currently down. */
  down: Set<PadButton>;
}

function chooseInitialLayout(pad: Gamepad): { layout: Layout; undecided: boolean } {
  if (pad.mapping === 'standard') return { layout: STANDARD, undecided: false };
  // Six axes is the giveaway that the triggers are axes. With four, the pad is
  // unmapped but shaped like the standard one, and reading it that way is the
  // best available guess — a pad with no trigger buttons just falls back to
  // the face buttons below.
  if (pad.axes.length >= 6) return { layout: LAYOUTS.xpad, undecided: true };
  return { layout: STANDARD, undecided: false };
}

/**
 * Reads one pad into logical controls.
 *
 * Kept free of the DOM and of `navigator` so it can be exercised with a plain
 * object standing in for a Gamepad: none of the layouts above can be checked
 * against hardware in CI, and the arithmetic is where they go wrong.
 */
export function readPad(pad: Gamepad, memory: PadMemory): PadSnapshot {
  const { axes } = pad;

  for (let i = 0; i < axes.length; i++) {
    if (axes[i] !== 0) memory.moved[i] = true;
    memory.resting[i] = axes[i] < -0.92 ? (memory.resting[i] ?? 0) + 1 : 0;
  }
  if (memory.undecided) {
    // Both raw layouts have a trigger on axis 5; they differ in whether its
    // partner is axis 2 or axis 4. Whichever of those is found parked at -1 is
    // the trigger — a stick only gets there by being held hard over, and does
    // not stay.
    if ((memory.resting[2] ?? 0) >= REST_FRAMES) {
      memory.layout = LAYOUTS.xpad;
      memory.undecided = false;
    } else if ((memory.resting[4] ?? 0) >= REST_FRAMES && Math.abs(axes[2] ?? 0) < 0.5) {
      memory.layout = LAYOUTS.hid;
      memory.undecided = false;
    }
  }
  const layout = memory.layout;

  const button = (index: number | undefined): number => {
    if (index === undefined) return 0;
    const b = pad.buttons[index];
    if (!b) return 0;
    return typeof b.value === 'number' && b.value > 0 ? b.value : b.pressed ? 1 : 0;
  };
  const trigger = (index: number): number => {
    if (layout.triggers.kind === 'button') return deadzone(button(index), TRIGGER_DEADZONE);
    if (!memory.moved[index]) return 0;
    return deadzone(((axes[index] ?? -1) + 1) / 2, TRIGGER_DEADZONE);
  };

  const down = new Set<PadButton>();
  for (const name of ALL_BUTTONS) {
    if (button(layout.buttons[name]) > 0.5) down.add(name);
  }
  if (layout.hat) {
    const hx = axes[layout.hat[0]] ?? 0;
    const hy = axes[layout.hat[1]] ?? 0;
    if (hx < -0.5) down.add('left');
    if (hx > 0.5) down.add('right');
    if (hy < -0.5) down.add('up');
    if (hy > 0.5) down.add('down');
  }

  const [lx] = stick(axes[0] ?? 0, axes[1] ?? 0);
  const [rx, ry] = stick(axes[layout.rightStick[0]] ?? 0, axes[layout.rightStick[1]] ?? 0);

  // RT and LT are the pedals. A is the handbrake, where a driving game puts
  // it, with X alongside for anyone whose thumb goes there instead.
  let throttle = trigger(layout.triggers.right);
  let brake = trigger(layout.triggers.left);
  let handbrake = Math.max(down.has('a') ? 1 : 0, down.has('x') ? 1 : 0);
  // A pad with no analog triggers at all — cheap, or old — gets the face
  // buttons as pedals instead, or it cannot be driven.
  const hasTriggers =
    layout.triggers.kind === 'axis' ||
    (pad.buttons.length > layout.triggers.right && pad.buttons.length > layout.triggers.left);
  if (!hasTriggers) {
    throttle = down.has('a') ? 1 : 0;
    brake = down.has('b') ? 1 : 0;
    handbrake = down.has('x') ? 1 : 0;
  }

  return {
    steer: Math.sign(lx) * Math.pow(Math.abs(lx), STEER_EXPO),
    throttle,
    brake,
    handbrake,
    orbit: rx,
    pitch: -ry,
    down,
  };
}

export function createPadMemory(pad: Gamepad): PadMemory {
  return { ...chooseInitialLayout(pad), moved: [], resting: [], held: new Set() };
}

/** "Xbox Wireless Controller", not the vendor-and-product string around it. */
export function padLabel(id: string): string {
  const name = id
    .replace(/\(.*?\)/g, ' ')
    .replace(/^[0-9a-f]{4}-[0-9a-f]{4}-/i, '')
    .replace(/\b(extended|standard) gamepad\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (name) return name;
  return /xbox|045e|microsoft/i.test(id) ? 'Xbox Wireless Controller' : 'Controller';
}

/**
 * Standard Gamepad API mapping (§7): left stick steers, RT/LT are the pedals.
 * Gamepads may appear on mobile too, so this source is always polled.
 */
export class GamepadSource implements InputSource {
  readonly id = 'gamepad';
  private memory = new Map<number, PadMemory>();
  /** The pad that last produced input, so two connected pads don't fight. */
  private current: number | null = null;
  private pressed = new Set<PadButton>();
  private lastFlick = { x: 0, y: 0 };

  /** Fired with the pad's display name when one connects, `null` when the last leaves. */
  onConnection: ((label: string | null) => void) | null = null;

  private onConnect = (e: GamepadEvent) => {
    this.memory.delete(e.gamepad.index);
    this.onConnection?.(padLabel(e.gamepad.id));
  };
  private onDisconnect = (e: GamepadEvent) => {
    this.memory.delete(e.gamepad.index);
    if (this.current === e.gamepad.index) this.current = null;
    if (connectedPads().length === 0) this.onConnection?.(null);
  };

  constructor() {
    if (typeof window === 'undefined') return;
    window.addEventListener('gamepadconnected', this.onConnect);
    window.addEventListener('gamepaddisconnected', this.onDisconnect);
  }

  /** The pad currently in use, for rumble. */
  get activePad(): Gamepad | null {
    if (this.current === null) return null;
    return connectedPads().find((p) => p.index === this.current) ?? null;
  }

  poll(out: VehicleInput, cam: CameraInput, _dt: number): boolean {
    let chosen: PadSnapshot | null = null;
    let chosenActive = false;

    for (const pad of connectedPads()) {
      let memory = this.memory.get(pad.index);
      if (!memory) {
        memory = createPadMemory(pad);
        this.memory.set(pad.index, memory);
      }
      const snap = readPad(pad, memory);
      const active =
        Math.abs(snap.steer) > 0 || snap.throttle > 0 || snap.brake > 0 ||
        snap.handbrake > 0 || Math.abs(snap.orbit) > 0 || Math.abs(snap.pitch) > 0 ||
        snap.down.size > 0;

      // Edges are collected from every pad: a press is a press whichever
      // controller it came from, and it also makes that pad the current one.
      for (const name of snap.down) {
        if (!memory.held.has(name)) this.pressed.add(name);
      }
      memory.held = snap.down;

      if (active) this.current = pad.index;
      if (pad.index === this.current || (!chosen && this.current === null)) {
        chosen = snap;
        chosenActive = active;
      }
    }

    if (!chosen) return false;
    out.steer = chosen.steer;
    out.throttle = chosen.throttle;
    out.brake = chosen.brake;
    out.handbrake = chosen.handbrake;
    cam.orbit = chosen.orbit;
    cam.pitch = chosen.pitch;
    return chosenActive;
  }

  /** True once per physical press. */
  consumePress(button: PadButton): boolean {
    return this.pressed.delete(button);
  }

  /** Drops press edges nobody asked about, so they can't fire later. */
  endFrame() {
    this.pressed.clear();
  }

  /**
   * The left stick as a D-pad, one step per push. For menus, where the stick
   * should move the selection once and then wait to be let go of.
   */
  consumeFlick(): { x: number; y: number } {
    const pad = this.activePad ?? connectedPads()[0];
    const x = pad ? Math.round((pad.axes[0] ?? 0) / (STICK_FLICK * 1.6)) : 0;
    const y = pad ? Math.round((pad.axes[1] ?? 0) / (STICK_FLICK * 1.6)) : 0;
    const step = {
      x: x !== 0 && this.lastFlick.x === 0 ? Math.sign(x) : 0,
      y: y !== 0 && this.lastFlick.y === 0 ? Math.sign(y) : 0,
    };
    this.lastFlick = { x, y };
    return step;
  }

  dispose() {
    window.removeEventListener('gamepadconnected', this.onConnect);
    window.removeEventListener('gamepaddisconnected', this.onDisconnect);
  }
}

export function connectedPads(): Gamepad[] {
  if (typeof navigator === 'undefined' || !navigator.getGamepads) return [];
  const pads: Gamepad[] = [];
  for (const pad of navigator.getGamepads()) {
    // Some HID devices register as a gamepad with no controls on them at all.
    if (pad && pad.connected && pad.axes.length >= 2 && pad.buttons.length >= 2) pads.push(pad);
  }
  return pads;
}

export function firstConnectedPad(): Gamepad | null {
  return connectedPads()[0] ?? null;
}

function deadzone(v: number, dz: number): number {
  if (Math.abs(v) < dz) return 0;
  // Rescale so the response starts at zero just outside the deadzone.
  return Math.sign(v) * ((Math.abs(v) - dz) / (1 - dz));
}

/** Radial dead zone: drift is a property of the stick, not of one axis of it. */
function stick(x: number, y: number): [number, number] {
  const length = Math.hypot(x, y);
  if (length < STICK_DEADZONE) return [0, 0];
  const scaled = Math.min(1, (length - STICK_DEADZONE) / (1 - STICK_DEADZONE));
  return [(x / length) * scaled, (y / length) * scaled];
}
