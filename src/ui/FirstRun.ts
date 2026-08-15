import type { VehicleTelemetry } from '../vehicle/Vehicle';
import { read, write } from '../settings/store';

/**
 * The four things a new player needs, delivered while they drive.
 *
 * There is no tutorial and there should not be one. §1 is decompression and the
 * boot path was rebuilt specifically so a tapped link reaches something you can
 * touch in half a second — putting a wall of instructions in front of that
 * spends the whole gain. So this is not a screen. It is four short lines that
 * appear over the desert at the moment each one becomes true, fade on their
 * own, and never come back.
 *
 * ## Triggered by state, never by a timer
 *
 * Every hint has a condition, and the condition is the point. "The compass
 * leans toward somewhere" is meaningless before there is a compass target and
 * patronising after you have already found three POIs. A timed sequence would
 * fire all four in the first fifteen seconds, most of them about things that
 * haven't happened yet, which is how tutorials end up teaching nothing.
 *
 * ## What is deliberately *not* here
 *
 * - **Controls on desktop.** The help strip already lists every key, on screen,
 *   permanently. Repeating it in a fading hint is worse than not saying it.
 * - **Getting unstuck, and airing down when bogged.** Ahmed owns both. He says
 *   them better, and he says them exactly when the sand has already made the
 *   point — a hint system that also mentioned it would step on the one moment
 *   the character is genuinely useful.
 * - **Anything about goals.** There aren't any. The first line says so once and
 *   then the game never brings it up again.
 */

interface Hint {
  id: string;
  text: string;
  /** True when this hint has become worth saying. */
  when(s: HintState): boolean;
}

export interface HintState {
  /** Seconds of actual driving, not seconds since load. */
  driven: number;
  distance: number;
  touch: boolean;
  /** True once the compass has somewhere undiscovered to point at. */
  hasTarget: boolean;
  found: number;
  /** False once the player has moved the tyres off the default. */
  defaultTyres: boolean;
  tel: VehicleTelemetry;
}

const HINTS: Hint[] = [
  {
    id: 'welcome',
    text: 'No timers, no score, no way to lose. Drive wherever you like.',
    // Once they're actually moving, so it lands over the desert rather than
    // over a parked truck they haven't touched yet.
    when: (s) => s.distance > 25,
  },
  {
    id: 'menu',
    text: 'Menu, top right — trucks, deserts, tyres, time of day.',
    // Touch only. On a keyboard every one of these is already in the help strip.
    when: (s) => s.touch && s.driven > 45,
  },
  {
    id: 'compass',
    text: 'The compass leans toward somewhere worth seeing. Or ignore it.',
    when: (s) => s.hasTarget && s.found === 0 && s.driven > 75,
  },
  {
    id: 'tyres',
    // The fallback for a player who never bogs down hard enough for Ahmed to
    // bring it up — otherwise they can finish a whole session without learning
    // the mechanic exists.
    text: 'Lower tyre pressure floats over soft sand. Higher is faster on firm.',
    when: (s) => s.defaultTyres && s.driven > 150,
  },
];

/** Seconds a hint stays up. Long enough to read twice at driving speed. */
const DWELL = 6.5;
/** Never two in a row without a gap, however many conditions have come true. */
const GAP = 12;

const STORAGE_KEY = 'dune.seen.v1';

export class FirstRun {
  readonly element: HTMLElement;

  private seen: Set<string>;
  private showing: Hint | null = null;
  private dwell = 0;
  private cooldown = 4;
  private driven = 0;
  private distance = 0;
  private lastX: number | null = null;
  private lastZ = 0;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'firstrun';
    this.element.hidden = true;
    this.seen = load();
  }

  /** True when every hint has been shown, so Game can stop calling update. */
  get done(): boolean {
    return HINTS.every((h) => this.seen.has(h.id));
  }

  /**
   * @param busy true while Ahmed is talking — he always wins. Two lines of text
   *             at the bottom of the screen at once is unreadable, and his are
   *             the ones with a character behind them.
   */
  update(dt: number, s: Omit<HintState, 'driven' | 'distance'>, x: number, z: number, busy: boolean) {
    if (this.lastX !== null) this.distance += Math.hypot(x - this.lastX, z - this.lastZ);
    this.lastX = x;
    this.lastZ = z;
    // Driving time, not wall time: someone who parks to look at the view should
    // not be walked through the whole set while stationary.
    if (s.tel.speedKph > 5) this.driven += dt;

    if (this.showing) {
      this.dwell -= dt;
      if (this.dwell <= 0) {
        this.element.classList.remove('is-open');
        this.showing = null;
        this.cooldown = GAP;
        setTimeout(() => { if (!this.showing) this.element.hidden = true; }, 400);
      }
      return;
    }

    this.cooldown -= dt;
    if (this.cooldown > 0 || busy) return;

    const state: HintState = { ...s, driven: this.driven, distance: this.distance };
    for (const hint of HINTS) {
      if (this.seen.has(hint.id) || !hint.when(state)) continue;
      this.show(hint);
      return;
    }
  }

  private show(hint: Hint) {
    this.showing = hint;
    this.dwell = DWELL;
    this.element.textContent = hint.text;
    this.element.hidden = false;
    requestAnimationFrame(() => this.element.classList.add('is-open'));
    // Persisted the moment it is shown rather than when it finishes: a player
    // who closes the tab mid-hint has still seen it, and getting it again on
    // the next visit is worse than missing the end of it once.
    this.seen.add(hint.id);
    save(this.seen);
  }

  /** Hidden in photo mode and behind the pickers. */
  setVisible(visible: boolean) {
    if (!visible) {
      this.element.classList.remove('is-open');
      this.element.hidden = true;
      this.showing = null;
    }
  }
}

function load(): Set<string> {
  try {
    const raw = read(STORAGE_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {
    // Corrupt: showing the hints again is a small cost.
  }
  return new Set();
}

function save(seen: Set<string>) {
  // Storage failures are handled inside the store and never surface here.
  write(STORAGE_KEY, JSON.stringify([...seen]));
}
