import type { SkyState } from '../engine/TimeOfDay';
import * as THREE from 'three';

/**
 * The shamal getting up properly.
 *
 * TimeOfDay already carries a haze term that rises through the afternoon, and
 * the crest plumes already derive their wind from it, so the world has a whole
 * weather system in it that never actually does anything you'd call weather.
 * This is the event on top of that: the horizon closes in, the sun goes to a
 * disc, the ridges start smoking hard, and for a couple of minutes you're
 * driving inside the dust instead of under it.
 *
 * It is not a hazard and there is nothing to survive (§11) — the traction
 * model doesn't know it's happening. What it is, is the only thing in the game
 * that changes what the world looks like without the player doing anything, and
 * the moment it lifts and the dunes come back is worth the two minutes it takes
 * to get there.
 *
 * Costs nothing to run: it moves numbers the sky, fog, lights and plumes are
 * already reading every frame.
 */

/** Peak storm intensity. Short of a white-out on purpose — you can always see
    the next dune, so the storm never becomes an obstacle. */
const PEAK = 0.85;

const BUILD_TIME = 46;
const CLEAR_TIME = 72;
const HOLD_MIN = 70;
const HOLD_RANGE = 70;

/** Earliest a storm can arrive in a session, seconds. */
const FIRST_GAP_MIN = 260;
/** Quiet spell between storms. */
const GAP_MIN = 380;
const GAP_RANGE = 300;

/** What the air turns when it is full of sand. */
const STORM_COLOR = new THREE.Color(0xc9a077);

export type WeatherEvent = 'arriving' | 'clearing' | null;

type Phase = 'clear' | 'building' | 'holding' | 'clearing';

export class Weather {
  /** 0..1, the shape of the storm. Read by the HUD-free world only. */
  intensity = 0;

  private phase: Phase = 'clear';
  private timer = FIRST_GAP_MIN + Math.random() * GAP_RANGE;
  private hold = 0;
  /** Runs regardless of phase, so the gusting is continuous through a storm. */
  private gustClock = Math.random() * 100;

  /**
   * @returns the transition that happened this frame, for Ahmed to remark on.
   */
  update(dt: number): WeatherEvent {
    this.gustClock += dt;
    this.timer -= dt;

    switch (this.phase) {
      case 'clear':
        if (this.timer <= 0) {
          this.phase = 'building';
          this.timer = BUILD_TIME;
          this.hold = HOLD_MIN + Math.random() * HOLD_RANGE;
          this.applyEnvelope();
          return 'arriving';
        }
        break;

      case 'building':
        if (this.timer <= 0) {
          this.phase = 'holding';
          this.timer = this.hold;
        }
        break;

      case 'holding':
        if (this.timer <= 0) {
          this.phase = 'clearing';
          this.timer = CLEAR_TIME;
          return 'clearing';
        }
        break;

      case 'clearing':
        if (this.timer <= 0) {
          this.phase = 'clear';
          this.timer = GAP_MIN + Math.random() * GAP_RANGE;
        }
        break;
    }

    this.applyEnvelope();
    return null;
  }

  private applyEnvelope() {
    let envelope: number;
    switch (this.phase) {
      case 'building':
        envelope = smoothstep(1 - this.timer / BUILD_TIME);
        break;
      case 'holding':
        envelope = 1;
        break;
      case 'clearing':
        envelope = smoothstep(this.timer / CLEAR_TIME);
        break;
      default:
        envelope = 0;
    }

    // Gusting. A storm that sits at one density for two minutes reads as a fog
    // slider; the whole character of one is that it surges and eases, and the
    // eased moments are what make the surges land.
    const gust =
      0.82 +
      0.13 * Math.sin(this.gustClock * 0.21) +
      0.05 * Math.sin(this.gustClock * 0.71 + 1.7);

    this.intensity = PEAK * envelope * gust;
  }

  /**
   * Folds the storm into the day's light. Called after TimeOfDay has evaluated
   * and before anything reads the state, so every consumer — sky shader, sun,
   * fog, hemisphere fill, and the crest plumes that derive their wind from the
   * haze — picks it up without knowing weather exists.
   */
  apply(state: SkyState) {
    const k = this.intensity;
    if (k <= 0.001) return;

    // Toward, never past: a storm at dawn is still a dawn.
    state.haze += (0.95 - state.haze) * k;
    state.hazeColor.lerp(STORM_COLOR, k * 0.7);

    // The horizon closing in is most of what sells it. Near comes in too, or
    // the near ground stays crisp while the middle distance vanishes, which
    // reads as a bug rather than as weather.
    state.fogFar += (170 - state.fogFar) * k;
    state.fogNear += (30 - state.fogNear) * k;

    // The sun survives as a disc rather than a source — the dust scatters the
    // beam into the whole sky, which is exactly what the hemisphere term is.
    state.sunIntensity *= 1 - 0.5 * k;
    state.hemiIntensity *= 1 + 0.25 * k;
    state.fog.lerp(STORM_COLOR, k * 0.75);
  }
}

function smoothstep(t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
}
