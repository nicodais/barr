import { AHMED_LINES, type LinePool } from '../data/ahmedLines';
import type { Poi } from '../data/pois';
import { activeRegion } from '../terrain/regions';
import { DISCOVERIES, DISCOVERY_RADIUS } from '../world/Discoveries';
import type { VehicleTelemetry } from '../vehicle/Vehicle';
import type { RadioSubtitles } from './RadioSubtitles';
import type { PressureId } from '../vehicle/tyrePressure';

/**
 * Decides when Ahmed keys up (§5).
 *
 * The brief is emphatic that dialogue is sparse and ambient: it plays over the
 * driving, never gates it, and he goes quiet for long stretches. So this is
 * mostly a set of governors — a global cooldown, one-shot POIs, and a rule that
 * nothing interrupts anything else — rather than a system that looks for excuses
 * to talk. Silence is the default state.
 */

/** Minimum gap between any two call-ins. */
const COOLDOWN = 26;
/** Longer gap after ambient chatter, so POIs stay the reason he calls. */
const AMBIENT_COOLDOWN = 75;
/** Seconds barely moving before he assumes you're bogged down. */
const STUCK_TIME = 9;
const STUCK_SPEED = 1.6;

export interface RadioCallbacks {
  onKeyUp(): void;
  onSignOff(): void;
}

export class Director {
  /** POIs already visited this session — each one only ever fires once. */
  private visited = new Set<string>();
  /** Small finds already remarked on. Session-only and never persisted: there
      is no completion state to restore, because there is nothing to complete. */
  private found = new Set<number>();
  /** Lines already used, so a session doesn't repeat itself (§13). */
  private used = new Map<LinePool, Set<number>>();
  /** Remaining beats of a POI call-in, delivered one at a time as it clears. */
  private pendingLines: string[] = [];

  private cooldown = 12;
  private stuckTimer = 0;
  private fastTimer = 0;
  private ambientTimer = 0;
  private signedOn = false;
  private pendingSignOff = 0;
  /** Tyre pressure as of the last change, so he can react to the direction. */
  private pressure: PressureId | null = null;
  /** Set when the player bogs down at road pressure; consumed by the next
   *  ambient slot so the hint lands just after the sand has made the point. */
  private pressureHintDue = false;
  /** He only ever explains this once. After that it is on you. */
  private hintedPressure = false;

  constructor(
    private subtitles: RadioSubtitles,
    private radio: RadioCallbacks,
    /** Fired the first time a POI is reached each session — Game persists it. */
    private onPoiVisit?: (poi: Poi) => void,
  ) {}

  update(tel: VehicleTelemetry, x: number, z: number, dt: number) {
    this.cooldown -= dt;
    this.ambientTimer -= dt;

    // A call-in in progress is never talked over.
    if (this.subtitles.busy) {
      // Queue the sign-off to land just after the line clears, not on top of it.
      if (this.pendingSignOff > 0) this.pendingSignOff = 0.9;
      return;
    }

    // Deliver the remaining beats of a POI call-in one at a time, as the same
    // breath — no fresh key-up static between them. The sign-off is armed only
    // once the last beat is out.
    if (this.pendingLines.length > 0) {
      const next = this.pendingLines.shift()!;
      this.speak(next, false);
      if (this.pendingLines.length === 0) this.pendingSignOff = 1.2;
      return;
    }

    if (this.pendingSignOff > 0) {
      this.pendingSignOff -= dt;
      if (this.pendingSignOff <= 0) {
        this.radio.onSignOff();
        this.speak(this.take('signOff'), false);
      }
      return;
    }

    if (!this.signedOn) {
      if (this.cooldown <= 0) {
        this.signedOn = true;
        this.call(this.take('signOn'));
      }
      return;
    }

    // --- points of interest, the only thing worth interrupting silence for ---
    for (const poi of activeRegion().pois) {
      if (this.visited.has(poi.id)) continue;
      if (Math.hypot(poi.x - x, poi.z - z) > poi.radius) continue;
      this.visited.add(poi.id);
      this.onPoiVisit?.(poi);
      this.callPoi(poi);
      return;
    }

    if (this.cooldown > 0) {
      this.trackAmbientConditions(tel, dt);
      return;
    }

    // --- small finds --------------------------------------------------------
    // Held to the ordinary cooldown but not to the much longer ambient timer:
    // these are the reward for going somewhere nobody sent you, and making one
    // wait seventy-five seconds behind an unrelated remark loses the moment.
    for (let i = 0; i < DISCOVERIES.length; i++) {
      if (this.found.has(i)) continue;
      const d = DISCOVERIES[i];
      if (Math.hypot(d.x - x, d.z - z) > DISCOVERY_RADIUS) continue;
      this.found.add(i);
      this.call(d.line);
      return;
    }

    // --- ambient chatter, heavily rate-limited ------------------------------
    this.trackAmbientConditions(tel, dt);
    if (this.ambientTimer > 0) return;

    if (this.stuckTimer >= STUCK_TIME) {
      this.stuckTimer = 0;
      this.ambientTimer = AMBIENT_COOLDOWN;
      // The hint outranks the ordinary stuck line, and only the first time.
      // Being told twice how tyres work is being told once too often.
      if (this.pressureHintDue) {
        this.pressureHintDue = false;
        this.hintedPressure = true;
        this.call(this.take('pressureHint'));
      } else {
        this.call(this.take('stuck'));
      }
      return;
    }

    if (tel.airborne && tel.airtime > 0.75) {
      this.ambientTimer = AMBIENT_COOLDOWN;
      this.call(this.take('airborne'));
      return;
    }

    if (this.fastTimer > 6) {
      this.fastTimer = 0;
      this.ambientTimer = AMBIENT_COOLDOWN;
      this.call(this.take('fast'));
    }
  }

  /**
   * The player airing up or down. Not held behind the ambient timer: it is a
   * direct response to something they just did, and a reply that arrives
   * seventy-five seconds later is not a reply.
   */
  onTyrePressure(id: PressureId) {
    const previous = this.pressure;
    this.pressure = id;
    if (previous === null || this.subtitles.busy || !this.signedOn) return;
    const down = axisOf(id) < axisOf(previous);
    // Airing down answers the hint, so retire it either way — he has had his say.
    this.pressureHintDue = false;
    this.hintedPressure = true;
    this.ambientTimer = AMBIENT_COOLDOWN;
    this.call(this.take(down ? 'airedDown' : 'airedUp'));
  }

  /**
   * Called by Game while the player is bogged down. The hint is armed here and
   * spoken later so it lands *after* the struggle rather than over it.
   */
  noteBogged(pressure: PressureId) {
    if (this.hintedPressure || pressure === 'sand') return;
    this.pressureHintDue = true;
  }

  /**
   * The shamal arriving or lifting. Held to the same governors as any other
   * ambient line — if he's mid-sentence or hasn't signed on yet, the weather
   * simply goes uncommented, which is better than him talking over himself
   * about it.
   */
  onWeather(event: 'arriving' | 'clearing') {
    if (this.subtitles.busy || !this.signedOn) return;
    this.ambientTimer = AMBIENT_COOLDOWN;
    this.call(this.take(event === 'arriving' ? 'stormIn' : 'stormOut'));
  }

  /**
   * Forgets which POIs and finds have been seen, for a region change. The line
   * pools are deliberately *not* reset: Ahmed shouldn't repeat his sign-on
   * because you drove somewhere else.
   */
  reset() {
    this.visited.clear();
    this.found.clear();
    this.pendingLines.length = 0;
    this.pendingSignOff = 0;
    this.cooldown = 6;
  }

  /** Hooked to the vehicle's damage-free auto-flip. */
  onRollover() {
    if (this.subtitles.busy || !this.signedOn) return;
    this.ambientTimer = AMBIENT_COOLDOWN;
    this.call(this.take('rollover'));
  }

  private trackAmbientConditions(tel: VehicleTelemetry, dt: number) {
    const crawling = tel.speedKph < STUCK_SPEED * 3.6 && tel.wheelsOnGround > 0;
    this.stuckTimer = crawling ? this.stuckTimer + dt : 0;
    this.fastTimer = tel.speedKph > 82 ? this.fastTimer + dt : 0;
  }

  /** Ambient chatter: one key-up, one line, no sign-off. */
  private call(line: string) {
    this.speak(line, true);
    this.cooldown = COOLDOWN;
  }

  /**
   * A POI call-in: key up once, deliver the first beat now and queue the rest,
   * then sign off after the last (§13). He only signs off for POIs, not for
   * every stray ambient comment.
   */
  private callPoi(poi: Poi) {
    this.speak(poi.lines[0], true);
    this.cooldown = COOLDOWN;
    this.pendingLines = poi.lines.slice(1);
    if (this.pendingLines.length === 0) this.pendingSignOff = 1.2;
  }

  private speak(line: string, keyUp: boolean) {
    if (keyUp) this.radio.onKeyUp();
    this.subtitles.show(line);
  }

  /**
   * Draws randomly from a pool and retires the line for the session, cycling
   * back only once the pool is exhausted (§13).
   */
  private take(pool: LinePool): string {
    const lines = AHMED_LINES[pool];
    let seen = this.used.get(pool);
    if (!seen) {
      seen = new Set();
      this.used.set(pool, seen);
    }
    if (seen.size >= lines.length) seen.clear();

    const available: number[] = [];
    for (let i = 0; i < lines.length; i++) if (!seen.has(i)) available.push(i);

    const pick = available[Math.floor(Math.random() * available.length)];
    seen.add(pick);
    return lines[pick];
  }
}

/** Ordering only, so 'aired up' and 'aired down' can be told apart. */
function axisOf(id: PressureId): number {
  return id === 'sand' ? 0 : id === 'mixed' ? 1 : 2;
}
