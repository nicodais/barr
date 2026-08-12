import { BODY_OPTIONS, type BodyId } from '../vehicle/vehicleConfig';
import { REGIONS, REGION_ORDER, type RegionId } from '../terrain/regions';
import type { JoystickPosition } from '../input/TouchSource';

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
  /** False on a keyboard, or on touch under a scheme with no thumbstick. */
  stickAvailable(): boolean;
}

const STICKS: Array<{ pos: JoystickPosition; label: string }> = [
  { pos: 'left', label: 'Left' },
  { pos: 'middle', label: 'Middle' },
  { pos: 'right', label: 'Right' },
];

/** Times worth jumping to, as fractions of the day cycle (see TimeOfDay). */
const TIMES: Array<{ label: string; at: number }> = [
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
  private open = false;
  /** Set while a region swap is in flight, so it can't be started twice. */
  private busy = false;

  constructor(private cb: MenuCallbacks) {
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'menu-button';
    this.button.setAttribute('aria-label', 'Menu');
    // Three bars drawn as spans, so there's no icon font and no SVG to inline.
    for (let i = 0; i < 3; i++) this.button.appendChild(document.createElement('span'));
    this.button.onclick = () => this.toggle();

    this.element = document.createElement('div');
    this.element.className = 'menu-panel';
    this.element.hidden = true;

    this.regionRow = this.section('Desert');
    this.bodyRow = this.section('Truck');
    this.timeRow = this.section('Time of day');
    this.stickRow = this.section('Thumbstick');

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
        this.cb.onTime(t.at);
        this.sync();
      }));
    }

    for (const s of STICKS) {
      this.stickRow.appendChild(this.chip(s.label, () => {
        this.cb.onStick(s.pos);
        this.sync();
      }));
    }

    this.element.append(
      this.regionRow.parentElement!,
      this.bodyRow.parentElement!,
      this.timeRow.parentElement!,
      this.stickRow.parentElement!,
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
    if (this.open) {
      this.sync();
      this.element.hidden = false;
      requestAnimationFrame(() => this.element.classList.add('is-open'));
    } else {
      this.element.classList.remove('is-open');
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
    // Nearest, wrapped: 0.97 is night, and so is 0.02.
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < TIMES.length; i++) {
      const raw = Math.abs(TIMES[i].at - time);
      const d = Math.min(raw, 1 - raw);
      if (d < bestD) { bestD = d; best = i; }
    }
    mark(this.timeRow, (i) => i === best);

    // Hidden rather than disabled: on a keyboard there is no thumbstick to
    // place, and a greyed-out row would just be a question nobody asked.
    const stick = this.cb.getStick();
    this.stickRow.parentElement!.hidden = !this.cb.stickAvailable();
    mark(this.stickRow, (i) => STICKS[i].pos === stick);
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

  private chip(label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'menu-chip';
    b.textContent = label;
    b.onclick = onClick;
    return b;
  }
}

function mark(row: HTMLElement, isActive: (i: number) => boolean) {
  const kids = Array.from(row.children) as HTMLElement[];
  for (let i = 0; i < kids.length; i++) kids[i].classList.toggle('is-active', isActive(i));
}
