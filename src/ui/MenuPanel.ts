import { BODY_OPTIONS, type BodyId } from '../vehicle/vehicleConfig';
import { REGIONS, REGION_ORDER, type RegionId } from '../terrain/regions';
import type { JoystickPosition } from '../input/TouchSource';
import { haptics } from '../input/Haptics';
import { PRESSURE_STEPS, type PressureId } from '../vehicle/tyrePressure';
import type { QualityTier } from '../engine/Quality';

export type QualityChoice = QualityTier | 'auto';

/**
 * Master volume as three named steps rather than a slider.
 *
 * The tuning panel had continuous sliders for master, music and effects, and
 * it is gone from player builds — so these have to carry the same job in a
 * chip row. Three points is enough: the carefully-set default, something quiet
 * enough for a room with other people in it, and off.
 */
const SOUND: Array<{ label: string; volume: number }> = [
  { label: 'Off', volume: 0 },
  { label: 'Low', volume: 0.45 },
  { label: 'Full', volume: 0.9 },
];

/** The score's own trim, kept separate because it is the balance people
 *  actually complain about — the oud sitting under the engine. */
const MUSIC: Array<{ label: string; volume: number }> = [
  { label: 'Low', volume: 0.4 },
  { label: 'Mid', volume: 0.7 },
  { label: 'Full', volume: 1 },
];

/**
 * Engine, tyres, wind and impacts.
 *
 * This row is here because for a while nothing was: `effectsVolume` was only
 * ever reachable from the tuning panel, and when that stopped shipping the
 * setting was pinned at 0.7 forever with no way to move it. The engine note is
 * how you read the traction model by ear (§2), so this is not a nicety.
 */
const EFFECTS: Array<{ label: string; volume: number }> = [
  { label: 'Low', volume: 0.35 },
  { label: 'Mid', volume: 0.7 },
  { label: 'Full', volume: 1 },
];

/**
 * Ahmed's lines, the hints and the POI card. Not the chips or the HUD — those
 * are sized to their containers and scaling them would break the layout to fix
 * a problem they don't have.
 */
const TEXT_SIZES: Array<{ label: string; scale: number }> = [
  { label: 'Small', scale: 0.88 },
  { label: 'Normal', scale: 1 },
  { label: 'Large', scale: 1.25 },
];

const CONTRAST: Array<{ label: string; on: boolean }> = [
  { label: 'Warm', on: false },
  { label: 'High', on: true },
];

const TIER_LABELS: Record<QualityTier, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

const QUALITIES: Array<{ label: string; value: QualityChoice }> = [
  { label: 'Auto', value: 'auto' },
  { label: 'Low', value: 'low' },
  { label: 'Med', value: 'medium' },
  { label: 'High', value: 'high' },
];

/**
 * Named for what they feel like, not for the flag behind them. The stored key
 * is `invertSteering` and it defaults to *true*, so a chip row labelled
 * "Normal / Inverted" would show a fresh install sitting on "Inverted" — which
 * reads as something being wrong rather than as the tuned default it is.
 */
const STEERING: Array<{ label: string; mirrored: boolean }> = [
  { label: 'Standard', mirrored: true },
  { label: 'Mirrored', mirrored: false },
];

/**
 * The hamburger, top-left.
 *
 * Desktop already had all of this scattered across three keyboard shortcuts —
 * G for the garage, T for options, the time slider inside options — which is
 * fine on a keyboard and invisible on a phone. This is the one place a touch
 * player can change the three things they'll actually want to change mid-drive:
 * where they are, what they're driving, and what time it is.
 *
 * Deliberately not a full menu. It holds the levers you reach for *while
 * driving* — where you are, what you're in, what time it is, and where your
 * thumb goes — and leaves the settings you set once (steering, quality, audio)
 * in the options panel where they belong.
 *
 * The stick row used to be its own floating puck pinned to the top-right. Two
 * controls competing for the same corner is one too many, and a setting that
 * only exists on one input scheme has no business owning permanent screen space
 * — it hides itself here instead when the scheme doesn't use it.
 */

interface MenuCallbacks {
  onRegion(id: RegionId): void;
  onBody(id: BodyId): void;
  onTime(t: number): void;
  onStick(pos: JoystickPosition): void;
  getRegion(): RegionId;
  getBody(): BodyId;
  getTime(): number;
  getStick(): JoystickPosition;
  onPressure(id: PressureId): void;
  getPressure(): PressureId;
  onSound(volume: number): void;
  getSound(): number;
  onMusic(volume: number): void;
  getMusic(): number;
  onEffects(volume: number): void;
  getEffects(): number;
  onDayCycle(moving: boolean): void;
  getDayCycle(): boolean;
  onQuality(q: QualityChoice): void;
  getQuality(): QualityChoice;
  /** What the game is actually running at right now, for the line under the
   *  Quality row. `drops` counts watchdog downgrades this session. */
  getPerf(): { tier: QualityTier; fps: number; draws: number; drops: number };
  onSteering(mirrored: boolean): void;
  getSteering(): boolean;
  onTextScale(scale: number): void;
  getTextScale(): number;
  onContrast(on: boolean): void;
  getContrast(): boolean;
  onGarage(): void;
  onHaptics(on: boolean): void;
  getHaptics(): boolean;
  /** False on a keyboard, or on touch under a scheme with no thumbstick. */
  stickAvailable(): boolean;
}

const VIBRATION: Array<{ on: boolean; label: string }> = [
  { on: true, label: 'On' },
  { on: false, label: 'Off' },
];

const STICKS: Array<{ pos: JoystickPosition; label: string }> = [
  { pos: 'left', label: 'Left' },
  { pos: 'middle', label: 'Middle' },
  { pos: 'right', label: 'Right' },
];

/**
 * Times worth jumping to, as fractions of the day cycle (see TimeOfDay).
 *
 * `Moving` is first and is the default: the 20-minute cycle is the whole
 * reason the keyframes, the blue hour and the moonlit night exist, and it had
 * been shipping switched off. Picking any named time freezes the sun there —
 * which is also the answer to "a moving sun changes the light I framed a photo
 * in": one tap parks it.
 */
const TIMES: Array<{ label: string; at: number | null }> = [
  { label: 'Moving', at: null },
  { label: 'Dawn', at: 0.09 },
  { label: 'Morning', at: 0.24 },
  { label: 'Midday', at: 0.42 },
  { label: 'Golden', at: 0.76 },
  { label: 'Sunset', at: 0.88 },
  { label: 'Night', at: 0.0 },
];

export class MenuPanel {
  readonly button: HTMLButtonElement;
  readonly element: HTMLElement;

  private regionRow: HTMLElement;
  private bodyRow: HTMLElement;
  private timeRow: HTMLElement;
  private stickRow: HTMLElement;
  private pressureRow: HTMLElement;
  private hapticRow: HTMLElement;
  private soundRow: HTMLElement;
  private musicRow: HTMLElement;
  private effectsRow: HTMLElement;
  private qualityRow: HTMLElement;
  private perfNote: HTMLElement;
  private steerRow: HTMLElement;
  private textRow: HTMLElement;
  private contrastRow: HTMLElement;
  private open = false;
  /** Ticks the perf line while the panel is up. */
  private perfTimer: number | null = null;
  /** Set while a region swap is in flight, so it can't be started twice. */
  private busy = false;

  constructor(private cb: MenuCallbacks) {
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'menu-button';
    this.button.setAttribute('aria-label', 'Menu');
    this.button.setAttribute('aria-expanded', 'false');
    // Three bars drawn as spans, so there's no icon font and no SVG to inline.
    for (let i = 0; i < 3; i++) this.button.appendChild(document.createElement('span'));
    this.button.onclick = () => {
      haptics.tick();
      this.toggle();
    };

    this.element = document.createElement('div');
    this.element.className = 'menu-panel';
    this.element.hidden = true;

    this.regionRow = this.section('Desert');
    this.bodyRow = this.section('Truck');
    this.timeRow = this.section('Time of day');
    this.stickRow = this.section('Thumbstick');
    // Above the thumbstick, not below: this one changes how the truck drives,
    // and the rows below it are preferences you set once.
    this.pressureRow = this.section('Tyres');
    this.hapticRow = this.section('Vibration');
    this.soundRow = this.section('Sound');
    this.musicRow = this.section('Music');
    this.effectsRow = this.section('Vehicle & world');
    this.qualityRow = this.section('Quality');
    // Sits inside the Quality group, under its chips: "Auto" is a promise and
    // this is what it actually resolved to. The HUD's stats grid carries the
    // same numbers but is hidden on touch, which is where they're needed.
    this.perfNote = document.createElement('span');
    this.perfNote.className = 'menu-note';
    this.qualityRow.parentElement!.appendChild(this.perfNote);
    this.steerRow = this.section('Steering');
    this.textRow = this.section('Text size');
    this.contrastRow = this.section('Contrast');

    for (const id of REGION_ORDER) {
      this.regionRow.appendChild(this.chip(REGIONS[id].name, () => {
        if (this.busy || id === this.cb.getRegion()) return;
        // Latched for the whole swap: it tears down and rebuilds the world, and
        // starting a second one halfway through the first leaves colliders
        // belonging to a region that no longer exists.
        this.busy = true;
        this.element.classList.add('is-busy');
        this.cb.onRegion(id);
      }));
    }
    for (const option of BODY_OPTIONS) {
      this.bodyRow.appendChild(this.chip(option.label, () => this.cb.onBody(option.id)));
    }
    for (const t of TIMES) {
      this.timeRow.appendChild(this.chip(t.label, () => {
        if (t.at === null) {
          this.cb.onDayCycle(true);
        } else {
          // Freeze first, so the jump isn't immediately walked off by the
          // cycle still running underneath it.
          this.cb.onDayCycle(false);
          this.cb.onTime(t.at);
        }
        this.sync();
      }));
    }

    for (const step of PRESSURE_STEPS) {
      const chip = this.chip(`${step.psi}`, () => {
        this.cb.onPressure(step.id);
        this.sync();
      });
      chip.title = `${step.label} — ${step.hint}`;
      this.pressureRow.appendChild(chip);
    }

    for (const s of STICKS) {
      this.stickRow.appendChild(this.chip(s.label, () => {
        this.cb.onStick(s.pos);
        this.sync();
      }));
    }
    for (const o of SOUND) {
      this.soundRow.appendChild(this.chip(o.label, () => {
        this.cb.onSound(o.volume);
        this.sync();
      }));
    }
    for (const o of MUSIC) {
      this.musicRow.appendChild(this.chip(o.label, () => {
        this.cb.onMusic(o.volume);
        this.sync();
      }));
    }
    for (const o of EFFECTS) {
      this.effectsRow.appendChild(this.chip(o.label, () => {
        this.cb.onEffects(o.volume);
        this.sync();
      }));
    }
    for (const o of QUALITIES) {
      this.qualityRow.appendChild(this.chip(o.label, () => {
        this.cb.onQuality(o.value);
        this.sync();
      }));
    }
    for (const o of STEERING) {
      this.steerRow.appendChild(this.chip(o.label, () => {
        this.cb.onSteering(o.mirrored);
        this.sync();
      }));
    }

    for (const o of TEXT_SIZES) {
      this.textRow.appendChild(this.chip(o.label, () => {
        this.cb.onTextScale(o.scale);
        this.sync();
      }));
    }
    for (const o of CONTRAST) {
      this.contrastRow.appendChild(this.chip(o.label, () => {
        this.cb.onContrast(o.on);
        this.sync();
      }));
    }

    for (const v of VIBRATION) {
      this.hapticRow.appendChild(this.chip(v.label, () => {
        this.cb.onHaptics(v.on);
        this.sync();
      }));
    }

    this.element.append(
      this.regionRow.parentElement!,
      this.bodyRow.parentElement!,
      this.timeRow.parentElement!,
      this.pressureRow.parentElement!,
      this.stickRow.parentElement!,
      this.hapticRow.parentElement!,
      this.soundRow.parentElement!,
      this.musicRow.parentElement!,
      this.effectsRow.parentElement!,
      this.qualityRow.parentElement!,
      this.steerRow.parentElement!,
      this.textRow.parentElement!,
      this.contrastRow.parentElement!,
      this.garageButton(),
    );
  }

  /** Called by Game once a region swap has finished rebuilding the world. */
  regionSettled() {
    this.busy = false;
    this.element.classList.remove('is-busy');
    this.sync();
  }

  toggle() {
    this.open = !this.open;
    this.button.classList.toggle('is-open', this.open);
    this.button.setAttribute('aria-expanded', String(this.open));
    if (this.open) {
      this.sync();
      this.element.hidden = false;
      requestAnimationFrame(() => this.element.classList.add('is-open'));
      // A one-shot reading of fps is a coin toss; watching it settle for a few
      // seconds is the measurement. Only runs while the panel is up.
      this.perfTimer = window.setInterval(() => this.syncPerf(), 500);
    } else {
      this.element.classList.remove('is-open');
      if (this.perfTimer !== null) {
        clearInterval(this.perfTimer);
        this.perfTimer = null;
      }
      setTimeout(() => { if (!this.open) this.element.hidden = true; }, 260);
    }
  }

  close() {
    if (this.open) this.toggle();
  }

  /** Hidden while the pre-drive pickers are up and in photo mode. */
  setVisible(visible: boolean) {
    this.button.hidden = !visible;
    if (!visible) this.close();
  }

  private sync() {
    const region = this.cb.getRegion();
    const body = this.cb.getBody();
    const time = this.cb.getTime();
    mark(this.regionRow, (i) => REGION_ORDER[i] === region);
    mark(this.bodyRow, (i) => BODY_OPTIONS[i].id === body);
    // Nearest, wrapped: 0.97 is night, and so is 0.02. Skips the `Moving` chip,
    // which owns the row outright whenever the cycle is running.
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < TIMES.length; i++) {
      const at = TIMES[i].at;
      if (at === null) continue;
      const raw = Math.abs(at - time);
      const d = Math.min(raw, 1 - raw);
      if (d < bestD) { bestD = d; best = i; }
    }
    const moving = this.cb.getDayCycle();
    mark(this.timeRow, (i) => (moving ? TIMES[i].at === null : i === best));

    const psi = this.cb.getPressure();
    mark(this.pressureRow, (i) => PRESSURE_STEPS[i].id === psi);

    // Hidden rather than disabled: on a keyboard there is no thumbstick to
    // place, and a greyed-out row would just be a question nobody asked.
    const stick = this.cb.getStick();
    this.stickRow.parentElement!.hidden = !this.cb.stickAvailable();
    mark(this.stickRow, (i) => STICKS[i].pos === stick);

    // Same reasoning, one step stronger: on a device with no vibration motor
    // — every iPhone, and every desktop — this isn't a setting that's turned
    // off, it's a setting that doesn't exist.
    const sound = this.cb.getSound();
    mark(this.soundRow, (i) => nearest(SOUND.map((o) => o.volume), sound) === i);
    const music = this.cb.getMusic();
    mark(this.musicRow, (i) => nearest(MUSIC.map((o) => o.volume), music) === i);
    const effects = this.cb.getEffects();
    mark(this.effectsRow, (i) => nearest(EFFECTS.map((o) => o.volume), effects) === i);
    const quality = this.cb.getQuality();
    mark(this.qualityRow, (i) => QUALITIES[i].value === quality);
    this.syncPerf();
    const mirrored = this.cb.getSteering();
    mark(this.steerRow, (i) => STEERING[i].mirrored === mirrored);
    const scale = this.cb.getTextScale();
    mark(this.textRow, (i) => nearest(TEXT_SIZES.map((o) => o.scale), scale) === i);
    const contrast = this.cb.getContrast();
    mark(this.contrastRow, (i) => CONTRAST[i].on === contrast);

    const on = this.cb.getHaptics();
    this.hapticRow.parentElement!.hidden = !haptics.supported;
    mark(this.hapticRow, (i) => VIBRATION[i].on === on);
  }

  private syncPerf() {
    const p = this.cb.getPerf();
    const parts = [TIER_LABELS[p.tier], `${Math.round(p.fps)} fps`, `${p.draws} draws`];
    // Only once it has happened. A permanent "dropped 0 times" is noise, and
    // the whole point of the counter is noticing when it isn't zero.
    if (p.drops > 0) parts.push(`stepped down ${p.drops}×`);
    this.perfNote.textContent = parts.join(' · ');
  }

  private section(label: string): HTMLElement {
    const group = document.createElement('div');
    group.className = 'menu-group';
    const name = document.createElement('span');
    name.className = 'menu-label';
    name.textContent = label;
    const row = document.createElement('div');
    row.className = 'menu-chips';
    group.append(name, row);
    return row;
  }

  /** Paint and wheels live in the garage; G reaches it on a keyboard and
   *  nothing did on a phone. */
  private garageButton(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'menu-group';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'menu-link';
    b.textContent = 'Garage — paint and wheels';
    b.onclick = () => {
      haptics.tick();
      this.close();
      this.cb.onGarage();
    };
    wrap.appendChild(b);
    return wrap;
  }

  private chip(label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'menu-chip';
    b.textContent = label;
    b.onclick = () => {
      // Before the handler rather than after, so the "On" chip's own
      // confirmation buzz pre-empts this tick instead of queueing behind it.
      haptics.tick();
      onClick();
    };
    return b;
  }
}

/** Index of the closest option, so a stored value that isn't exactly on a step
 *  still lights one up rather than leaving the row looking unset. */
function nearest(values: number[], v: number): number {
  let best = 0;
  for (let i = 1; i < values.length; i++) {
    if (Math.abs(values[i] - v) < Math.abs(values[best] - v)) best = i;
  }
  return best;
}

function mark(row: HTMLElement, isActive: (i: number) => boolean) {
  const kids = Array.from(row.children) as HTMLElement[];
  for (let i = 0; i < kids.length; i++) kids[i].classList.toggle('is-active', isActive(i));
}
