import type { TerrainStats } from '../terrain/TerrainStreamer';
import type { VehicleTelemetry } from '../vehicle/Vehicle';

/**
 * Prototype instrumentation, not the shipping HUD — §4 wants a diegetic
 * dashboard eventually. This exists to answer "why did that feel wrong?" while
 * tuning: it surfaces the state you cannot see from the chase camera, notably
 * how soft the sand under the tyres is and how much suspension travel is left.
 */
export class DebugHud {
  readonly element: HTMLElement;

  private speedEl: HTMLElement;
  private psiEl: HTMLElement;
  private barsEl: HTMLElement;
  private statsEl: HTMLElement;
  private flagsEl: HTMLElement;
  private bars: HTMLElement[] = [];

  private fps = 0;
  private frameAccum = 0;
  private frameCount = 0;
  private drawCalls = 0;

  /**
   * Read by the menu's performance line. The stats grid this normally feeds is
   * hidden on touch viewports — the exact devices where §8's 60fps target has
   * never been measured — so the number has to be reachable from somewhere a
   * phone can actually see.
   */
  get framesPerSecond(): number {
    return this.fps;
  }

  get draws(): number {
    return this.drawCalls;
  }

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'hud';

    this.speedEl = document.createElement('div');
    this.speedEl.className = 'hud-speed';

    // Under the speed, where a dash readout belongs. It changes rarely, so it
    // has to be *there* when you go looking rather than shout for attention.
    this.psiEl = document.createElement('div');
    this.psiEl.className = 'hud-psi';

    this.barsEl = document.createElement('div');
    this.barsEl.className = 'hud-bars';
    for (let i = 0; i < 4; i++) {
      const slot = document.createElement('div');
      slot.className = 'hud-bar';
      const fill = document.createElement('i');
      slot.appendChild(fill);
      this.barsEl.appendChild(slot);
      this.bars.push(fill);
    }

    this.statsEl = document.createElement('div');
    this.statsEl.className = 'hud-stats';

    this.flagsEl = document.createElement('div');
    this.flagsEl.className = 'hud-flags';

    this.element.append(this.speedEl, this.psiEl, this.barsEl, this.statsEl, this.flagsEl);
  }

  update(
    t: VehicleTelemetry,
    wheels: Array<{ compression: number; contact: boolean }>,
    terrain: TerrainStats,
    drawCalls: number,
    dt: number,
    psi: number,
  ) {
    // Rounded, and it moves while the tyres are still changing — watching the
    // number walk down is the confirmation that something is happening.
    this.psiEl.textContent = `${Math.round(psi)} psi`;
    this.psiEl.classList.toggle('is-low', psi < 19);
    this.drawCalls = drawCalls;
    this.frameAccum += dt;
    this.frameCount++;
    if (this.frameAccum >= 0.4) {
      this.fps = this.frameCount / this.frameAccum;
      this.frameAccum = 0;
      this.frameCount = 0;
    }

    const reversing = t.forwardSpeed < -0.5;
    this.speedEl.innerHTML =
      `<b>${Math.round(t.speedKph)}</b><small>km/h${reversing ? ' · R' : ''}</small>`;

    for (let i = 0; i < this.bars.length; i++) {
      const w = wheels[i];
      const pct = w ? Math.round(w.compression * 100) : 0;
      this.bars[i].style.height = `${Math.max(4, pct)}%`;
      this.bars[i].style.opacity = w?.contact ? '1' : '0.28';
    }

    this.statsEl.innerHTML = [
      row('sand', `${Math.round(t.surfaceSoftness * 100)}%`),
      row('roll', `${Math.round((t.rollAngle * 180) / Math.PI)}°`),
      row('pitch', `${Math.round((t.pitchAngle * 180) / Math.PI)}°`),
      row('drift', `${Math.round(Math.abs((t.slipAngle * 180) / Math.PI))}°`),
      row('grip', `${t.wheelsOnGround}/4`),
      row('fps', this.fps.toFixed(0)),
      // Draw calls is the number §8 actually budgets (~150), so show the real
      // renderer figure rather than a count of resident chunks.
      row('draws', String(drawCalls)),
      row('chunks', `${terrain.resident}${terrain.pending ? ` +${terrain.pending}` : ''}`),
      row('phys', String(terrain.colliders)),
    ].join('');

    const flags: string[] = [];
    if (t.airborne && t.airtime > 0.18) flags.push(`AIR ${t.airtime.toFixed(1)}s`);
    if (t.rolledOver) flags.push('ROLLED');
    if (t.climbing && t.surfaceSoftness > 0.45) flags.push('SOFT CLIMB');
    if (Math.abs(t.slipAngle) > 0.28) flags.push('DRIFT');
    if (Math.abs(t.rollAngle) > 0.6 && !t.rolledOver) flags.push('TIPPING');
    this.flagsEl.textContent = flags.join('   ');
  }
}

function row(label: string, value: string): string {
  return `<span><i>${label}</i>${value}</span>`;
}
