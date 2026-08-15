/**
 * The phone buzzing when the sand does something.
 *
 * There is exactly one haptics API on the web — `navigator.vibrate` — and it is
 * far cruder than a console rumble motor: no amplitude, no frequency, no
 * channels. All you can say is "on for N milliseconds", optionally as a
 * pattern of on/off runs. Everything expressive has to come out of duration and
 * rhythm, so the cues here are written as *shapes* (a double click, a tumble, a
 * thud) rather than as intensities.
 *
 * Two consequences drive the whole design:
 *
 * 1. **There is one motor, and a new call cancels whatever is running.** A
 *    stray 8ms UI tick landing 20ms into a rollover pattern doesn't layer over
 *    it, it truncates it. So every cue carries a priority and the class tracks
 *    when the current one is due to finish; a quieter cue arriving mid-pattern
 *    is dropped rather than allowed to stomp.
 * 2. **Continuous rumble is not available and should not be faked.** The motor
 *    takes tens of milliseconds to spin up and audibly buzzes; a per-frame
 *    vibrate call to simulate engine rumble would drain the battery, rattle on
 *    the table louder than the speaker, and feel like a notification stuck on
 *    repeat. Texture is therefore *event*-driven — a tick when a wheel actually
 *    takes a hit — and hard rate-limited.
 *
 * iOS is the notable gap *on the web*: Safari implements no vibration API at
 * all, on any version, so `supported` is false on every iPhone and iPad in a
 * browser and the setting hides itself rather than offering a switch that does
 * nothing. Android Chrome, Firefox and Samsung Internet all have it.
 *
 * ## In the iOS app
 *
 * The native build reaches the Taptic Engine instead, which is a better device
 * than any of the above — real transients with distinct weights rather than one
 * motor with a duration. It cannot do the one thing this file is written
 * around, though: arbitrary on/off patterns. So the cues are not rewritten for
 * it. Each pattern is replayed as a *sequence of impacts on the pattern's own
 * timings*, with the weight of each hit chosen by how long that run was, which
 * keeps the shape — the double click, the tumble, the thud — intact. The shape
 * was always the design; the durations were only ever the crude way of
 * expressing it, and on iOS they get a better one.
 */

import { Capacitor } from '@capacitor/core';
import { Haptics as Taptic, ImpactStyle } from '@capacitor/haptics';
import type { VehicleTelemetry, WheelState } from '../vehicle/Vehicle';

/** The native shell, where the Taptic Engine replaces `navigator.vibrate`. */
const NATIVE = Capacitor.isNativePlatform();

type Pattern = number | number[];

/**
 * Who gets the motor when two cues collide. A landing outranks the corrugation
 * ticks it interrupts; a rollover outranks everything, because it's the one
 * moment the game asks you to notice.
 */
const P = {
  ui: 0,
  texture: 1,
  event: 2,
  land: 3,
  rollover: 4,
} as const;
type Priority = (typeof P)[keyof typeof P];

/**
 * Minimum gap between corrugation ticks. Measured rather than guessed: at 0.17
 * a sustained rough section produced 5 ticks a second, which on a real motor
 * has stopped being separate hits and become a buzz. At 0.32 the worst case
 * caps at three, which still reads as chatter over broken ground.
 */
const BUMP_GAP = 0.32;
/**
 * How fast the suspension has to be compressing before it counts as a hit, in
 * fractions of total travel per second.
 *
 * A *rate*, not a per-frame delta, and the distinction is not academic: the
 * same physical bump spreads over one frame at 20fps and over three at 60, so a
 * per-frame threshold quietly makes the effect frame-rate dependent — present
 * on a slow device, absent on a fast one, which is exactly backwards from what
 * anyone tuning it would expect.
 *
 * Set from a measured drive rather than picked: across a dune run the rate sits
 * at 0.02 for half the frames and tops out near 5.5, so this sits at about the
 * 97th percentile. Anything much above 3 was a channel that never fired at all.
 */
const BUMP_RATE = 2.8;
/** Rate above the threshold that counts as a maximum-strength hit. */
const BUMP_RANGE = 3;
/** Under this there's nothing to feel — the truck is crawling. */
const BUMP_MIN_SPEED = 5;

/**
 * Gap between "wheels are just digging" pulses. Slower than the wheels are
 * actually spinning, on purpose — this wants to read as a labouring throb, not
 * as an alarm going off at you for getting stuck (§2: a moment, not a penalty).
 */
const BOG_GAP = 0.62;

export class Haptics {
  /**
   * The device can actually do this. False on desktop and on iOS *in a
   * browser*; true in the iOS app, where the Taptic Engine is available.
   */
  readonly supported: boolean;

  private on = true;
  /**
   * Vibration requires user activation; calls before the first gesture are
   * ignored by the browser and log a warning, so hold off until one arrives.
   */
  private armed = false;
  private busyUntil = 0;
  private busyPriority: Priority = P.ui;

  private bumpTimer = 0;
  private bogTimer = 0;
  private compression = [0, 0, 0, 0];
  /** Pending hits of a multi-part cue, so `stop` can actually stop one. */
  private pending: number[] = [];

  constructor() {
    this.supported = NATIVE ||
      (typeof navigator !== 'undefined' &&
      typeof navigator.vibrate === 'function' &&
      // Chrome on desktop defines `vibrate` and silently does nothing with it.
      // Same test the touch controls use, so the setting appears in exactly the
      // sessions where the controls it belongs next to do.
      matchMedia('(pointer: coarse)').matches);

    if (!this.supported) return;

    // The user-activation rule is a browser rule. The Taptic Engine has no such
    // requirement, so the native build is armed from the start rather than
    // swallowing whatever cue happens to land before the first tap.
    if (NATIVE) this.armed = true;
    const arm = () => { this.armed = true; };
    window.addEventListener('pointerdown', arm, { once: true, passive: true });
    window.addEventListener('keydown', arm, { once: true });

    // A pattern keeps running after the tab goes away. Backgrounding the game
    // mid-rollover and having the phone keep buzzing in a pocket is the kind of
    // thing that gets vibration switched off for good.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.stop();
    });
  }

  setEnabled(on: boolean) {
    this.on = on;
    if (!on) {
      this.stop();
      return;
    }
    // Confirm in the medium being switched on: you should feel what you just
    // turned on, not read that it happened.
    this.fire([12, 50, 20], P.event);
  }

  /** UI tap. Deliberately at the edge of perception — this is punctuation. */
  tick() {
    this.fire(8, P.ui);
  }

  /**
   * Touchdown after air. Scaled by the same 0..1 impact the dust burst uses, so
   * what you feel and what you see come off one number.
   */
  land(impact: number) {
    if (impact < 0.12) return;
    this.fire(Math.round(14 + impact * 46), P.land);
  }

  /** The damage-free auto-flip (§2): a tumble, then the truck settling. */
  rollover() {
    this.fire([45, 55, 22, 40, 70], P.rollover);
  }

  /** Ahmed keying up — the haptic half of the "kssshhht" (§6). */
  radioKeyUp() {
    this.fire([12, 40, 12], P.event);
  }

  /** His shorter sign-off cue. */
  radioSignOff() {
    this.fire(10, P.event);
  }

  /** Arriving somewhere. Softer and rounder than an impact. */
  arrive() {
    this.fire([18, 45, 32], P.event);
  }

  /**
   * Tyres changing pressure. The longest cue here, and the only one that is a
   * *sustain* rather than an impact — air moving, not something hitting
   * something. Nothing else in the set would be mistaken for it.
   */
  tyres() {
    this.fire([30, 60, 30, 60, 55], P.event);
  }

  /** A photo taken. Mirrors a camera's mirror-slap: hard, then closed. */
  shutter() {
    this.fire([22, 30, 10], P.event);
  }

  /** Faded out at the region edge and set back down inside it. */
  boundary() {
    this.fire([28, 90, 28], P.event);
  }

  /**
   * Per-frame texture. Two channels, both rate-limited into "occasional" rather
   * than "constant": a tick when a wheel takes a real hit, and a slow pulse
   * while the throttle is open and the truck isn't going anywhere.
   */
  update(tel: VehicleTelemetry, wheels: WheelState[], throttle: number, dt: number) {
    if (!this.supported || !this.on) return;

    this.bumpTimer -= dt;
    this.bogTimer -= dt;

    // --- corrugations -------------------------------------------------------
    // Read off how fast the suspension is being *compressed*, not off the
    // terrain: the spring is already the filter that decides what reaches the
    // occupants, so anything it swallows shouldn't reach the hand either.
    let jolt = 0;
    for (let i = 0; i < wheels.length && i < this.compression.length; i++) {
      const c = wheels[i].compression;
      if (wheels[i].contact) jolt = Math.max(jolt, (c - this.compression[i]) / dt);
      this.compression[i] = c;
    }

    if (
      this.bumpTimer <= 0 &&
      jolt > BUMP_RATE &&
      tel.speed > BUMP_MIN_SPEED &&
      !tel.airborne
    ) {
      this.bumpTimer = BUMP_GAP;
      const strength = Math.min(1, (jolt - BUMP_RATE) / BUMP_RANGE);
      this.fire(Math.round(7 + strength * 13), P.texture);
    }

    // --- bogged down --------------------------------------------------------
    // Throttle open, wheels on soft sand, truck not moving: the one moment the
    // brief explicitly calls out as "a moment, not a punishment" (§2). A slow
    // pulse says the sand is winning without ever saying you failed.
    const digging =
      throttle > 0.4 &&
      tel.speedKph < 6 &&
      tel.wheelsOnGround >= 3 &&
      tel.surfaceSoftness > 0.35;
    if (digging && this.bogTimer <= 0) {
      this.bogTimer = BOG_GAP;
      this.fire(Math.round(14 + tel.surfaceSoftness * 12), P.texture);
    }
  }

  private stop() {
    if (!this.supported) return;
    if (NATIVE) this.clearPending();
    else navigator.vibrate(0);
    this.busyUntil = 0;
    this.busyPriority = P.ui;
  }

  private fire(pattern: Pattern, priority: Priority) {
    if (!this.supported || !this.on || !this.armed || document.hidden) return;

    const now = performance.now();
    // The motor is a single shared resource and `vibrate` pre-empts rather than
    // queues, so a lesser cue arriving mid-pattern is dropped outright. Equal
    // priority does pre-empt: two landings in a row should feel like the second
    // one, not like the first one finishing.
    if (now < this.busyUntil && priority < this.busyPriority) return;

    if (NATIVE) this.tap(pattern);
    else navigator.vibrate(pattern);
    this.busyUntil = now + span(pattern);
    this.busyPriority = priority;
  }

  /**
   * Replays a vibration pattern on the Taptic Engine.
   *
   * A pattern is `[on, off, on, off, …]`, so the even entries are the hits and
   * the odd ones are the gaps between them. Each hit fires at its own cumulative
   * offset, which is what preserves the rhythm the cue was written as. The
   * first one goes out synchronously — a scheduled zero-delay tap is a frame
   * late, and on a UI tick that lateness is the whole cue.
   *
   * Pre-emption is handled by clearing first, matching `vibrate`'s behaviour of
   * replacing rather than queueing: the priority check above has already
   * decided this cue wins.
   */
  private tap(pattern: Pattern) {
    this.clearPending();
    if (typeof pattern === 'number') {
      void Taptic.impact({ style: weight(pattern) });
      return;
    }
    let at = 0;
    for (let i = 0; i < pattern.length; i += 2) {
      const hit = pattern[i];
      const style = weight(hit);
      if (at === 0) void Taptic.impact({ style });
      else this.pending.push(setTimeout(() => void Taptic.impact({ style }), at));
      at += hit + (pattern[i + 1] ?? 0);
    }
  }

  private clearPending() {
    for (const id of this.pending) clearTimeout(id);
    this.pending.length = 0;
  }
}

/**
 * How hard a hit of this length should land.
 *
 * The thresholds come off the existing cue set rather than being round numbers:
 * the 8ms UI tick and the 7-20ms corrugation ticks want the lightest transient
 * there is, the 12-32ms radio and shutter clicks want a definite but unhurried
 * one, and the 45-70ms rollover and heavy-landing runs want everything the
 * engine has.
 */
function weight(ms: number): ImpactStyle {
  if (ms < 12) return ImpactStyle.Light;
  if (ms < 34) return ImpactStyle.Medium;
  return ImpactStyle.Heavy;
}

function span(pattern: Pattern): number {
  if (typeof pattern === 'number') return pattern;
  let total = 0;
  for (const v of pattern) total += v;
  return total;
}

/**
 * One motor, one owner. Instances don't compose — a second one would keep its
 * own idea of what's currently playing and happily cut the first one's patterns
 * in half — and the UI surfaces that want a tap tick are scattered widely
 * enough that threading a reference through all of them would be worse.
 */
export const haptics = new Haptics();
