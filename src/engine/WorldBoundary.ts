import { smoothstep } from '../terrain/height';

/**
 * The soft edge of the curated region (§5, §11). The dune field is procedurally
 * endless, so there's no wall and no void — instead, once the player drives well
 * past the outermost points of interest the screen fades to a warm haze, and at
 * full fade the truck is set back down inside the region facing the centre. It's
 * damage-free and never blocks: you keep driving the whole time it fades.
 *
 * The boundary uses the max-of-axes distance (a square, matching the region's
 * shape) so a corner POI like the survey pylons never sits in the fade zone.
 */
const FADE_START = 760;
const FADE_FULL = 900;
/** How long the haze eases back off after a respawn, in seconds. */
const FADE_OUT_TIME = 0.9;

export class WorldBoundary {
  readonly element: HTMLElement;
  private fade = 0;
  private returning = false;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'boundary-fade';
  }

  /**
   * Advances the fade for this frame and returns true once the player is far
   * enough out to be respawned. On a true result the caller warps the truck back
   * inside; the haze then eases off on its own over the next FADE_OUT_TIME.
   */
  update(x: number, z: number, dt: number): boolean {
    let respawn = false;
    if (this.returning) {
      this.fade = Math.max(0, this.fade - dt / FADE_OUT_TIME);
      if (this.fade <= 0) this.returning = false;
    } else {
      const m = Math.max(Math.abs(x), Math.abs(z));
      this.fade = smoothstep(FADE_START, FADE_FULL, m);
      if (this.fade >= 1) {
        this.returning = true;
        respawn = true;
      }
    }
    this.element.style.opacity = this.fade.toFixed(3);
    return respawn;
  }
}
