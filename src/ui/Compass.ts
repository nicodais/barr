/**
 * The dashboard compass (§5): a slim tick-tape ribbon showing heading, with one
 * soft diamond nudging toward the nearest undiscovered POI. Deliberately not an
 * objective marker — no distance, no name, no path — just "something that way",
 * exactly the register of Ahmed saying "there's a ridge past the old well".
 * When everything has been found the diamond retires and the ribbon is just a
 * compass. A small counter keeps the collection legible across sessions.
 */
const PX_PER_DEG = 2;
const CARDINALS: Array<[number, string]> = [[0, 'N'], [90, 'E'], [180, 'S'], [270, 'W']];

export class Compass {
  readonly element: HTMLElement;
  private tape: HTMLElement;
  private marker: HTMLElement;
  private countEl: HTMLElement;
  private width = 0;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'compass';

    this.tape = document.createElement('div');
    this.tape.className = 'compass-tape';
    // Three copies of the 360° strip so the visible window always has tape
    // under it regardless of wraparound.
    for (let rev = -1; rev <= 1; rev++) {
      for (let deg = 0; deg < 360; deg += 15) {
        const at = (rev * 360 + deg) * PX_PER_DEG;
        const cardinal = CARDINALS.find(([d]) => d === deg);
        if (cardinal) {
          const label = document.createElement('span');
          label.className = 'compass-cardinal';
          label.textContent = cardinal[1];
          label.style.left = `${at}px`;
          this.tape.appendChild(label);
        } else {
          const tick = document.createElement('span');
          tick.className = 'compass-tick';
          tick.style.left = `${at}px`;
          this.tape.appendChild(tick);
        }
      }
    }
    this.element.appendChild(this.tape);

    const centre = document.createElement('span');
    centre.className = 'compass-centre';
    this.element.appendChild(centre);

    this.marker = document.createElement('span');
    this.marker.className = 'compass-marker';
    this.marker.textContent = '◆';
    this.marker.hidden = true;
    this.element.appendChild(this.marker);

    this.countEl = document.createElement('span');
    this.countEl.className = 'compass-count';
    this.element.appendChild(this.countEl);
  }

  /**
   * @param heading        yaw in radians, 0 = +Z ("north"), matching atan2(x, z)
   * @param targetBearing  world bearing of the nudge target, or null for none
   */
  update(heading: number, targetBearing: number | null, found: number, total: number) {
    if (this.width === 0) this.width = this.element.clientWidth;
    const headingDeg = ((heading * 180) / Math.PI + 360) % 360;
    this.tape.style.transform = `translateX(${-headingDeg * PX_PER_DEG}px)`;

    if (targetBearing === null) {
      this.marker.hidden = true;
    } else {
      this.marker.hidden = false;
      let rel = ((targetBearing - heading) * 180) / Math.PI;
      rel = ((rel + 540) % 360) - 180;
      const limit = Math.max(0, this.width / 2 - 12);
      const offset = Math.max(-limit, Math.min(limit, rel * PX_PER_DEG));
      // Pinned at the edge means "behind you / far off to the side" — the
      // diamond dims rather than pointing anywhere exact.
      this.marker.classList.toggle('compass-marker-edge', Math.abs(rel * PX_PER_DEG) > limit);
      this.marker.style.transform = `translateX(calc(-50% + ${offset}px))`;
    }

    this.countEl.textContent = `${found}/${total}`;
  }

  show() {
    this.element.hidden = false;
  }

  hide() {
    this.element.hidden = true;
  }
}
