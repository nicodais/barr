/**
 * Every number that decides how the truck feels (§2). Exposed as one flat,
 * live-editable object because the brief is explicit that this gets tuned by
 * feel rather than by chasing real suspension specs — so the loop from "that
 * felt wrong" to "try this" has to be seconds, not a rebuild.
 *
 * Reference silhouette is a Nissan Patrol Super Safari: ~4.8m long, 1.85m wide,
 * 2.9m wheelbase, a bit over two tonnes.
 */
export interface VehicleTuning {
  // --- world ---
  /**
   * Gravity magnitude, m/s². Deliberately above Earth's 9.81.
   *
   * At real gravity the truck reads as floaty: a crest launch hangs for over a
   * second and the wheels skip contact across undulations. Heavier gravity is
   * the standard fix and it's what makes the truck feel bolted to the ground.
   *
   * It cannot be raised on its own. Every force below is scaled with it (see
   * DEFAULT_TUNING) — leave them behind and a 30° dune face needs more thrust
   * than the engine has, which silently kills the momentum-climb mechanic.
   */
  gravity: number;

  // --- chassis ---
  mass: number;
  /** COM offset below the body centre. Lower = harder to tip. */
  comHeight: number;
  /** Resistance to rolling. Low = snappy flick, high = slow majestic lean. */
  rollInertia: number;
  pitchInertia: number;
  yawInertia: number;

  // --- suspension ---
  suspensionRest: number;
  suspensionStiffness: number;
  suspensionCompression: number;
  suspensionRelaxation: number;
  suspensionTravel: number;
  maxSuspensionForce: number;

  // --- drivetrain ---
  engineForce: number;
  topSpeed: number;
  brakeForce: number;
  handbrakeForce: number;
  reverseForce: number;
  /** Coasting drag standing in for engine braking and rolling resistance. */
  engineBrake: number;
  /** Holds the truck on a slope when stopped, so parked stays parked. */
  parkBrake: number;

  // --- steering ---
  maxSteerAngle: number;
  /** Steer lock retained at top speed, 0..1. Keeps high speed from twitching. */
  highSpeedSteerFactor: number;
  steerRate: number;

  // --- tyres / sand (§2 sand traction model) ---
  hardpackGrip: number;
  sandGrip: number;
  hardpackSideGrip: number;
  sandSideGrip: number;
  /** Grip lost on steep faces, on top of the softness term. */
  slopeGripLoss: number;
  /**
   * Rear lateral grip as a fraction of the front's. Below 1 the back steps out
   * first, so a turn rotates into a slide instead of pushing wide. This is the
   * drift dial: lower is looser and more sideways, 1.0 tracks like a rail.
   */
  rearGripBias: number;
  /**
   * How firmly the truck's rotation is pulled toward the rate the steering is
   * actually asking for (the Ackermann rate for the current lock and speed).
   *
   * This is what makes a slide *controllable* rather than a coin flip. Grip
   * alone gives no usable middle ground: enough rear grip to be stable and it
   * refuses to rotate at all, a little less and any slide diverges into a spin
   * that continues after you've straightened the wheels. Pulling toward the
   * commanded rate does both jobs — it rotates the truck into the corner more
   * eagerly, and it gathers the back up once yaw runs past what you asked for.
   * 0 disables it entirely.
   */
  yawAssist: number;
  /** Ceiling on the assisted yaw rate, rad/s, so it can't demand a pirouette. */
  maxYawRate: number;
  /** Rolling resistance from sinking into soft sand. */
  sinkDrag: number;
  /** How much soft sand robs a climb of power. This is the momentum mechanic. */
  climbBleed: number;

  // --- rollover (damage-free, §2) ---
  /** Chassis up.y below this counts as rolled. */
  rollThreshold: number;
  /** Seconds upside-down before the gentle auto-flip. */
  rollRecoverDelay: number;
}

/**
 * Gravity is 1.53x Earth. Under dynamic similarity, holding lengths fixed and
 * scaling every force by the same factor keeps the *shapes* of the motion
 * identical — the same slopes stay climbable, the truck sits at the same ride
 * height — while everything plays out sqrt(1.53) ≈ 1.24x faster. That speed-up
 * is precisely the "planted" feeling; the geometry of the handling is untouched.
 *
 * So if you change `gravity`, scale the forces marked below with it or the
 * handling silently comes apart.
 */
const G_SCALE = 12 / 9.81;

export const DEFAULT_TUNING: VehicleTuning = {
  gravity: 12,

  mass: 2100,
  comHeight: 0.35,
  rollInertia: 1200,
  // Raised: pitch inertia is what governs how violently the nose dives under
  // braking, and a heavy 4x4 should settle onto its front springs rather than
  // snap onto them.
  pitchInertia: 4400,
  // Lowered: yaw inertia is what resists the truck rotating about its own
  // vertical axis, so a high value damps out exactly the rotation a drift is
  // made of. Still heavy enough to feel like two tonnes rather than a go-kart.
  yawInertia: 2700,

  // Longer rest length than feels natural on paper: rest + wheel radius is the
  // raycast reach, so it sets how far the ground can drop away before the wheel
  // simply stops finding it. That geometric limit — not the damping — is what
  // makes a truck skip across undulations.
  suspensionRest: 0.50,
  suspensionStiffness: 22 * G_SCALE,
  // Damping scales as sqrt(gravity) to keep the same number of oscillations.
  // Compression is biased up beyond that: it damps the nose-dive specifically.
  suspensionCompression: 3.2 * Math.sqrt(G_SCALE),
  suspensionRelaxation: 4.0 * Math.sqrt(G_SCALE),
  suspensionTravel: 0.38,
  maxSuspensionForce: 80000 * G_SCALE,

  engineForce: 3400 * G_SCALE,
  // Kept at the real-world value: this is a speed we actually want (~120km/h),
  // not something to scale. The truck just reaches it more urgently now.
  topSpeed: 33,
  // Softened from 2600: a heavy 4x4 on sand should wash off speed progressively
  // and settle, not stand on its nose. ~0.4g, which still stops it promptly.
  brakeForce: 2050 * G_SCALE,
  handbrakeForce: 4200 * G_SCALE,
  reverseForce: 1900 * G_SCALE,
  engineBrake: 420 * G_SCALE,
  parkBrake: 3200 * G_SCALE,

  maxSteerAngle: 0.58,
  // Fraction of lock surviving at top speed. Enough to steer and to catch a
  // slide, not enough to demand grip that doesn't exist.
  highSpeedSteerFactor: 0.25,
  steerRate: 3.4,

  // These are friction-circle radii — roughly a tyre's friction coefficient, so
  // physical values live near 1. The old 2.2 let the tyres pull over twice their
  // own load sideways, which meant they never saturated and the truck simply
  // could not be made to slide.
  hardpackGrip: 1.35,
  sandGrip: 0.7,
  // Lateral grip is deliberately well below longitudinal: the truck should push
  // sideways across sand rather than carve (§2).
  hardpackSideGrip: 0.6,
  sandSideGrip: 0.3,
  slopeGripLoss: 0.35,
  // Raised from 0.72 with the side-grip trim. This is the dial that decides how
  // readily the back steps out, and the bodies that slid worst were the ones
  // rotating rather than running wide.
  rearGripBias: 0.76,
  yawAssist: 2.4,
  maxYawRate: 1.2,
  // Grip coefficients above are dimensionless multipliers on normal load, so
  // they scale with gravity for free. Sink drag is an explicit force and doesn't.
  sinkDrag: 900 * G_SCALE,
  climbBleed: 0.85,

  rollThreshold: 0.2,
  rollRecoverDelay: 1.1,
};

// Geometry is fixed (it's the vehicle's identity, not a feel knob).
export const CHASSIS_HALF = { x: 0.92, y: 0.55, z: 2.15 };
export const WHEEL_RADIUS = 0.42;
export const WHEEL_WIDTH = 0.3;
export const HALF_TRACK = 0.8;
export const HALF_WHEELBASE = 1.45;
/** Suspension hard-point height relative to the chassis body origin. */
export const AXLE_HEIGHT = -0.25;
