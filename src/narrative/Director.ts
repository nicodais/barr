import {
  AHMED_LINES, AHMED_REGION_LINES, AHMED_VEHICLE_LINES, type LinePool,
} from '../data/ahmedLines';
import type { Poi } from '../data/pois';
import { activeRegion, type RegionId } from '../terrain/regions';
import type { BodyId } from '../vehicle/vehicleConfig';
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
  /**
   * Armed when the vehicle or the region changes, and consumed by the next
   * ambient slot rather than spoken on the spot.
   *
   * These arrive in a cluster — you pick a desert, then a truck, then he signs
   * on — and firing all three immediately would be a wall of text over the
   * first ten seconds of a game whose whole brief is decompression (§1).
   * Arming them instead means the remark lands a minute in, once you have
   * actually been driving the thing he is talking about.
   */
  private vehicleDue: BodyId | null = null;
  private regionDue: RegionId | null = null;
  /** Per-body and per-region lines are their own pools, tracked separately so
   *  trying three trucks gets three different remarks. */
  private usedVehicle = new Map<BodyId, Set<number>>();
  private usedRegion = new Map<RegionId, Set<number>>();
  /**
   * The band of the day right now, and the last one he actually remarked on.
   *
   * Two fields rather than one because they answer different questions. The
   * first attempt kept only "the band I last saw" and dropped the remark
   * whenever the crossing happened to land inside a cooldown — which silently
   * lost that band for the entire cycle. Keeping what he has *said* separately
   * means a crossing that arrives at a busy moment is simply still owed, and
   * gets picked up as soon as the radio is quiet.
   */
  private band: TimeBand | null = null;
  private spokenBand: TimeBand | null = null;

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

    // Below the driving reactions, above nothing: what you're in and where you
    // are is texture, and it waits for a genuinely quiet moment.
    if (this.vehicleDue) {
      const body = this.vehicleDue;
      this.vehicleDue = null;
      this.ambientTimer = AMBIENT_COOLDOWN;
      this.call(takeFrom(AHMED_VEHICLE_LINES[body], this.usedVehicle, body));
      return;
    }

    if (this.regionDue) {
      const region = this.regionDue;
      this.regionDue = null;
      this.ambientTimer = AMBIENT_COOLDOWN;
      this.call(takeFrom(AHMED_REGION_LINES[region], this.usedRegion, region));
      return;
    }

    // The band he's owed a remark on. Read fresh rather than from whenever the
    // crossing happened, so if the radio was busy through dusk and it is now
    // dark, he talks about the dark.
    if (this.band !== null && this.band !== this.spokenBand) {
      const band = this.band;
      this.spokenBand = band;
      this.ambientTimer = AMBIENT_COOLDOWN;
      this.call(this.take(band));
      return;
    }

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

  /** The truck you chose, or changed to. Arms a remark for the next quiet slot. */
  noteVehicle(body: BodyId) {
    this.vehicleDue = body;
  }

  /** The desert you're in. Same treatment. */
  noteRegion(region: RegionId) {
    this.regionDue = region;
  }

  /**
   * The day turning over — dawn, midday, dusk, dark. Handed over every frame;
   * everything interesting happens when it differs from what he last said.
   */
  onTimeBand(band: TimeBand) {
    // The first reading only establishes where the day started. He doesn't
    // announce a time nobody has watched change.
    if (this.spokenBand === null) this.spokenBand = band;
    this.band = band;
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

/** The four bands of the day worth a remark. Named for the light, not the clock. */
export type TimeBand = 'dawn' | 'midday' | 'dusk' | 'nightfall';

/**
 * Which band a point in the day cycle falls in. Deliberately gapless — every
 * `t` belongs to exactly one band, so the crossings are what fire rather than
 * entering some special zone, and no part of the day is unaccounted for.
 *
 * The edges follow TimeOfDay's keyframes rather than clock hours: `dusk` opens
 * at 0.62 because that is where the light starts going long, and `nightfall`
 * closes at 0.05 because that is the pre-dawn blue hour, which reads as the
 * end of the night and not the start of the morning.
 */
export function timeBand(t: number): TimeBand {
  const u = ((t % 1) + 1) % 1;
  if (u < 0.05) return 'nightfall';
  if (u < 0.3) return 'dawn';
  if (u < 0.62) return 'midday';
  if (u < 0.93) return 'dusk';
  return 'nightfall';
}

/**
 * `take`, but over a keyed table rather than the flat pools — same retire-and-
 * recycle rule (§13), tracked per key so each truck and each desert keeps its
 * own history.
 */
function takeFrom<K>(lines: string[], seenBy: Map<K, Set<number>>, key: K): string {
  let seen = seenBy.get(key);
  if (!seen) {
    seen = new Set();
    seenBy.set(key, seen);
  }
  if (seen.size >= lines.length) seen.clear();

  const available: number[] = [];
  for (let i = 0; i < lines.length; i++) if (!seen.has(i)) available.push(i);

  const pick = available[Math.floor(Math.random() * available.length)];
  seen.add(pick);
  return lines[pick];
}
