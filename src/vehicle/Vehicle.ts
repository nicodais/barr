import type RAPIER from '@dimforge/rapier3d-compat';
import { WORLD_HALF, heightAt, softnessAt } from '../terrain/height';
import type { VehicleInput } from '../input/types';
import {
  AXLE_HEIGHT,
  CHASSIS_HALF,
  DEFAULT_TUNING,
  HALF_TRACK,
  HALF_WHEELBASE,
  WHEEL_RADIUS,
  type VehicleTuning,
} from './VehicleTuning';

const WHEELBASE = HALF_WHEELBASE * 2;

export interface WheelState {
  /** Local-space wheel centre, already displaced by suspension travel. */
  x: number;
  y: number;
  z: number;
  steer: number;
  spin: number;
  contact: boolean;
  /** 0 = fully extended, 1 = bottomed out. Drives the visual squat. */
  compression: number;
  softness: number;
  /** World-space point where the wheel meets the ground. Only valid on contact. */
  contactX: number;
  contactY: number;
  contactZ: number;
  /** World-space ground normal at that point. Only valid on contact. */
  normalX: number;
  normalY: number;
  normalZ: number;
}

export type RecoverReason = 'rollover' | 'manual' | 'fell';

export interface VehicleTelemetry {
  speed: number;
  speedKph: number;
  /** Signed: negative when reversing. */
  forwardSpeed: number;
  /** Signed world-space vertical velocity. Negative is falling. */
  verticalSpeed: number;
  /** 0..1 severity of the landing that happened this step, 0 otherwise. */
  landingImpact: number;
  wheelsOnGround: number;
  airborne: boolean;
  airtime: number;
  rollAngle: number;
  pitchAngle: number;
  /** Mean softness under the contacting wheels, 0..1. */
  surfaceSoftness: number;
  /**
   * Signed angle between where the truck points and where it's actually going,
   * in radians. This is the drift: 0 means tracking true, large means sliding.
   */
  slipAngle: number;
  climbing: boolean;
  rolledOver: boolean;
  gearRatio: number;
}

const WHEEL_LAYOUT: Array<{ x: number; z: number; steered: boolean; driven: boolean }> = [
  { x: -HALF_TRACK, z: HALF_WHEELBASE, steered: true, driven: true },
  { x: HALF_TRACK, z: HALF_WHEELBASE, steered: true, driven: true },
  { x: -HALF_TRACK, z: -HALF_WHEELBASE, steered: false, driven: true },
  { x: HALF_TRACK, z: -HALF_WHEELBASE, steered: false, driven: true },
];

const UP = { x: 0, y: 1, z: 0 };

/** Forward speed under which the brake counts as having stopped the truck. */
const REVERSE_ARM_SPEED = 0.5;
/** Seconds at rest, on the brake, before reverse engages at all. */
const REVERSE_ARM_DELAY = 0.3;
/** Seconds for reverse thrust to fade in once armed. */
const REVERSE_RAMP_TIME = 0.35;

/** Below this the truck has left the heightfield; catch it and put it back. */
const FALL_LIMIT = -40;
/** Keep recoveries comfortably inside the streamed region's edge. */
const RECOVER_BOUND = WORLD_HALF - 40;

/**
 * The truck. Rapier's raycast vehicle controller supplies per-wheel suspension
 * and a slip-based tyre model; everything layered on top here exists to make it
 * feel like two tonnes of live-axle 4x4 on sand rather than a kart on a plane.
 */
export class Vehicle {
  readonly body: RAPIER.RigidBody;
  readonly controller: RAPIER.DynamicRayCastVehicleController;
  readonly wheels: WheelState[] = [];
  tuning: VehicleTuning = { ...DEFAULT_TUNING };

  readonly telemetry: VehicleTelemetry = {
    speed: 0,
    speedKph: 0,
    forwardSpeed: 0,
    verticalSpeed: 0,
    landingImpact: 0,
    wheelsOnGround: 0,
    airborne: false,
    airtime: 0,
    rollAngle: 0,
    pitchAngle: 0,
    surfaceSoftness: 0,
    slipAngle: 0,
    climbing: false,
    rolledOver: false,
    gearRatio: 0,
  };

  /** Fired when the auto-flip triggers — a hook for dust FX and Ahmed lines. */
  onRecover: ((reason: RecoverReason) => void) | null = null;

  private rapier: typeof RAPIER;
  private world: RAPIER.World;
  private steerAngle = 0;
  private stoppedTimer = 0;
  private reverseRamp = 0;
  private lastVerticalSpeed = 0;
  private rolledTimer = 0;
  private lastUprightYaw = 0;
  private lastUprightPos = { x: 0, y: 0, z: 0 };
  private uprightSampleTimer = 0;

  constructor(
    rapier: typeof RAPIER,
    world: RAPIER.World,
    spawn: { x: number; y: number; z: number },
  ) {
    this.rapier = rapier;
    this.world = world;

    const bodyDesc = rapier.RigidBodyDesc.dynamic()
      .setTranslation(spawn.x, spawn.y, spawn.z)
      .setLinearDamping(0.05)
      .setAngularDamping(0.4)
      .setCanSleep(false);
    this.body = world.createRigidBody(bodyDesc);

    // Explicit mass properties rather than density: the low centre of mass and
    // the roll inertia are feel parameters, not consequences of box geometry.
    const t = this.tuning;
    this.body.setAdditionalMassProperties(
      t.mass,
      { x: 0, y: -t.comHeight, z: 0 },
      { x: t.pitchInertia, y: t.yawInertia, z: t.rollInertia },
      { w: 1, x: 0, y: 0, z: 0 },
      true,
    );

    const colliderDesc = rapier.ColliderDesc
      .cuboid(CHASSIS_HALF.x, CHASSIS_HALF.y, CHASSIS_HALF.z)
      .setDensity(0)
      .setFriction(0.4)
      .setRestitution(0.05);
    world.createCollider(colliderDesc, this.body);

    this.controller = world.createVehicleController(this.body);
    this.controller.indexUpAxis = 1;
    this.controller.setIndexForwardAxis = 2;

    for (const w of WHEEL_LAYOUT) {
      this.controller.addWheel(
        { x: w.x, y: AXLE_HEIGHT, z: w.z },
        { x: 0, y: -1, z: 0 }, // suspension ray direction
        { x: -1, y: 0, z: 0 }, // axle
        t.suspensionRest,
        WHEEL_RADIUS,
      );
      this.wheels.push({
        x: w.x, y: AXLE_HEIGHT - t.suspensionRest, z: w.z,
        steer: 0, spin: 0, contact: false, compression: 0, softness: 0,
        contactX: 0, contactY: 0, contactZ: 0,
        normalX: 0, normalY: 1, normalZ: 0,
      });
    }

    this.applyTuning();
    this.lastUprightPos = { ...spawn };
  }

  /** Pushes tuning values into Rapier. Safe to call every frame while tuning. */
  /**
   * How soft the sand feels to these tyres, 0.42 (aired down) .. 1 (road).
   *
   * Set by Game from the pressure control. It multiplies the terrain's own
   * softness rather than any single handling number, which is what makes one
   * value produce four consistent effects at once — see tyrePressure.ts.
   */
  tyreSoftnessScale = 1;

  applyTuning() {
    const t = this.tuning;
    // Gravity is a world property but very much a vehicle *feel* parameter, so
    // it lives in the tuning set and is pushed from here.
    this.world.gravity.y = -t.gravity;
    for (let i = 0; i < this.controller.numWheels(); i++) {
      this.controller.setWheelSuspensionRestLength(i, t.suspensionRest);
      this.controller.setWheelSuspensionStiffness(i, t.suspensionStiffness);
      this.controller.setWheelSuspensionCompression(i, t.suspensionCompression);
      this.controller.setWheelSuspensionRelaxation(i, t.suspensionRelaxation);
      this.controller.setWheelMaxSuspensionTravel(i, t.suspensionTravel);
      this.controller.setWheelMaxSuspensionForce(i, t.maxSuspensionForce);
    }
    this.body.setAdditionalMassProperties(
      t.mass,
      { x: 0, y: -t.comHeight, z: 0 },
      { x: t.pitchInertia, y: t.yawInertia, z: t.rollInertia },
      { w: 1, x: 0, y: 0, z: 0 },
      true,
    );
  }

  update(input: VehicleInput, dt: number) {
    const t = this.tuning;
    const rot = this.body.rotation();
    const forward = rotateVec(rot, { x: 0, y: 0, z: 1 });
    const up = rotateVec(rot, UP);
    const vel = this.body.linvel();

    // Rapier's `currentVehicleSpeed()` is Bullet-derived: it returns the full
    // velocity *magnitude* with a sign taken from the forward axis, so a pure
    // vertical drop reads as high forward speed. Project it properly instead —
    // steering falloff and the speedo both depend on this being honest.
    const forwardSpeed = vel.x * forward.x + vel.y * forward.y + vel.z * forward.z;
    const speed = Math.hypot(vel.x, vel.y, vel.z);
    const speedFrac = Math.min(1, Math.abs(forwardSpeed) / t.topSpeed);

    // --- steering: speed-sensitive lock, rate-limited ------------------------
    // Snapping to the target angle is what makes arcade handling feel weightless,
    // hence the rate limit below.
    //
    // The falloff is quadratic, not linear. A 2.9m wheelbase at 70km/h with 20°
    // of lock describes an 8m radius — about 4g of lateral demand, which no tyre
    // can supply, so the truck just saturates and spins on any input. Full lock
    // survives at parking speed where it's genuinely useful, then drops away
    // quickly enough that high-speed steering asks for something achievable.
    const steerFalloff = (1 - speedFrac) * (1 - speedFrac);
    const lock =
      t.maxSteerAngle * (t.highSpeedSteerFactor + (1 - t.highSpeedSteerFactor) * steerFalloff);
    const target = input.steer * lock;
    const maxStep = t.steerRate * lock * dt;
    this.steerAngle += clamp(target - this.steerAngle, -maxStep, maxStep);

    // --- surface sampling ----------------------------------------------------
    let contactCount = 0;
    let softnessSum = 0;
    for (let i = 0; i < this.wheels.length; i++) {
      const contact = this.controller.wheelIsInContact(i);
      let softness = 0;
      let slopeLoss = 0;

      if (contact) {
        contactCount++;
        const cp = this.controller.wheelContactPoint(i);
        // A wider contact patch does not change what the sand is, it changes
        // how soft the sand is *to this tyre*.
        if (cp) softness = softnessAt(cp.x, cp.z) * this.tyreSoftnessScale;
        const n = this.controller.wheelContactNormal(i);
        if (n) {
          // Steeper face -> less of the tyre's load turns into usable grip.
          const steepness = 1 - Math.min(1, Math.abs(n.y));
          slopeLoss = steepness * t.slopeGripLoss;
        }
        softnessSum += softness;
      }

      // Rear wheels get less bite than the fronts so the back steps out first
      // and the truck rotates into a slide. Crucially this scales the friction
      // *circle* as well as lateral stiffness: with equal circles front and rear
      // both axles saturate together and the result is understeer — the truck
      // scrubs speed and plows straight on, which is the opposite of a drift.
      const rearBias = WHEEL_LAYOUT[i].steered ? 1 : t.rearGripBias;
      const grip = lerp(t.hardpackGrip, t.sandGrip, softness) * (1 - slopeLoss) * rearBias;
      const sideGrip =
        lerp(t.hardpackSideGrip, t.sandSideGrip, softness) * (1 - slopeLoss) * rearBias;
      this.controller.setWheelFrictionSlip(i, Math.max(0.15, grip));
      this.controller.setWheelSideFrictionStiffness(i, Math.max(0.1, sideGrip));
      this.wheels[i].softness = softness;
    }
    const meanSoftness = contactCount > 0 ? softnessSum / contactCount : 0;

    // --- drivetrain ----------------------------------------------------------
    // Nose-up on loose sand bleeds power hard: carrying enough run-up to crest a
    // face is the skill the whole sand model exists to make legible (§2).
    const climbing = forward.y > 0.02;
    const climbPenalty = climbing ? 1 - meanSoftness * forward.y * t.climbBleed : 1;
    // Quadratic falloff gives a natural-feeling top speed without a hard clamp.
    const speedFalloff = Math.max(0, 1 - speedFrac * speedFrac);

    let engineForce = 0;
    let brakeForce = 0;
    const braking = input.brake > 0.05;

    // Reverse has to be earned: the truck must actually come to rest under the
    // brake, then dwell, before it engages — and it ramps in rather than
    // switching. Swapping full braking for full reverse thrust in a single step
    // reverses the force on the chassis while it's still rolling forward, and
    // since that force acts at ground level with the CoM above it, the truck
    // pitches straight onto its nose.
    if (!braking || input.throttle > 0.01) {
      this.stoppedTimer = 0;
      this.reverseRamp = 0;
    } else {
      this.stoppedTimer = forwardSpeed < REVERSE_ARM_SPEED ? this.stoppedTimer + dt : 0;
      if (this.stoppedTimer >= REVERSE_ARM_DELAY) {
        this.reverseRamp = Math.min(1, this.reverseRamp + dt / REVERSE_RAMP_TIME);
      }
    }

    if (braking) {
      if (this.reverseRamp > 0) {
        engineForce =
          -input.brake * t.reverseForce * this.reverseRamp *
          Math.max(0, 1 - Math.abs(forwardSpeed) / 12);
        // Bleed the brake out as reverse comes in so there's never a frame with
        // neither, which would let the nose spring back.
        brakeForce = input.brake * t.brakeForce * (1 - this.reverseRamp);
      } else {
        brakeForce = input.brake * t.brakeForce;
      }
    }

    if (input.throttle > 0.01) {
      if (forwardSpeed < -0.8) {
        // Throttle while rolling backwards brakes first, then pulls away.
        brakeForce = Math.max(brakeForce, input.throttle * t.brakeForce);
      } else {
        engineForce = input.throttle * t.engineForce * speedFalloff * Math.max(0.15, climbPenalty);
      }
    }

    // Coasting drag. Without this the truck free-rolls down a dune indefinitely
    // — physically defensible, but it means walking away from the keyboard and
    // coming back 200m downhill, which is the opposite of relaxing.
    if (input.throttle < 0.05 && input.brake < 0.05) {
      brakeForce = Math.max(brakeForce, t.engineBrake);
      // Below walking pace, hold it properly so slopes don't cause a slow creep.
      if (Math.abs(forwardSpeed) < 0.6) brakeForce = Math.max(brakeForce, t.parkBrake);
    }

    const handbrake = input.handbrake * t.handbrakeForce;

    for (let i = 0; i < this.wheels.length; i++) {
      const layout = WHEEL_LAYOUT[i];
      this.controller.setWheelSteering(i, layout.steered ? this.steerAngle : 0);
      this.controller.setWheelEngineForce(i, layout.driven ? engineForce : 0);
      // Handbrake is rears-only so it pivots the truck instead of just stopping it.
      //
      // The `* dt` is essential and easy to miss: unlike engine force, which
      // Rapier scales by the timestep internally, the brake value is a maximum
      // *impulse*. Passing a force straight in applies it 60x over, which
      // cancels all forward velocity in a couple of steps and dumps the
      // resulting angular momentum into a violent nose-dive. Keeping the tuning
      // in newtons and converting here also makes braking timestep-independent.
      const brakeImpulse = (brakeForce + (layout.steered ? 0 : handbrake)) * dt;
      this.controller.setWheelBrake(i, brakeImpulse);
    }

    // --- sink drag -----------------------------------------------------------
    // Soft sand doesn't just reduce grip, it actively resists forward motion.
    // Without this, loose sand reads as "ice" rather than "deep".
    if (contactCount > 0 && speed > 0.2) {
      const drag = meanSoftness * this.tuning.sinkDrag * (contactCount / this.wheels.length);
      const scale = (-drag * dt) / speed;
      this.body.applyImpulse(
        { x: vel.x * scale, y: 0, z: vel.z * scale },
        true,
      );
    }

    // --- yaw assist ----------------------------------------------------------
    // Pull the truck's rotation toward what the steering is asking for. Grounded
    // only: airborne this would let the player pirouette on nothing.
    if (contactCount > 0 && t.yawAssist > 0 && Math.abs(forwardSpeed) > 1.5) {
      const commanded = (forwardSpeed / WHEELBASE) * Math.tan(this.steerAngle);
      const target = clamp(commanded, -t.maxYawRate, t.maxYawRate);
      const yawError = target - this.body.angvel().y;
      // torque = inertia * angular acceleration; scaled by how much of the
      // truck is actually on the ground to sell a wheel-in-the-air moment.
      const authority = contactCount / this.wheels.length;
      const torque = yawError * t.yawAssist * t.yawInertia * authority;
      this.body.applyTorqueImpulse({ x: 0, y: torque * dt, z: 0 }, true);
    }

    this.controller.updateVehicle(dt, this.rapier.QueryFilterFlags.EXCLUDE_DYNAMIC);

    this.readWheelState();
    this.updateRollover(up, dt);

    // --- telemetry -----------------------------------------------------------
    const tel = this.telemetry;

    // Touchdown detection, for the dust burst and suspension slam. Uses the
    // vertical speed from *before* the solver absorbed the landing, since by the
    // time contact is registered the impact has already been damped away.
    const wasAirborne = tel.airborne;
    tel.landingImpact =
      wasAirborne && contactCount > 0
        ? clamp(-this.lastVerticalSpeed / 14, 0, 1)
        : 0;
    this.lastVerticalSpeed = vel.y;

    tel.speed = speed;
    tel.speedKph = Math.abs(forwardSpeed) * 3.6;
    tel.forwardSpeed = forwardSpeed;
    tel.verticalSpeed = vel.y;
    tel.wheelsOnGround = contactCount;
    tel.airborne = contactCount === 0;
    tel.airtime = tel.airborne ? tel.airtime + dt : 0;
    tel.rollAngle = Math.atan2(rotateVec(rot, { x: 1, y: 0, z: 0 }).y, up.y);
    tel.pitchAngle = Math.asin(clamp(forward.y, -1, 1));
    tel.surfaceSoftness = meanSoftness;

    // Slip angle, measured on the horizontal plane only so that cresting a dune
    // doesn't register as a slide. Meaningless below walking pace and while
    // reversing, where the velocity is legitimately opposed to the nose.
    const horizontalSpeed = Math.hypot(vel.x, vel.z);
    if (horizontalSpeed > 1.5 && forwardSpeed > 0.5) {
      const dot = forward.x * vel.x + forward.z * vel.z;
      const cross = forward.x * vel.z - forward.z * vel.x;
      tel.slipAngle = Math.atan2(cross, dot);
    } else {
      tel.slipAngle = 0;
    }

    tel.climbing = climbing;
    tel.gearRatio = speedFalloff;
  }

  private readWheelState() {
    for (let i = 0; i < this.wheels.length; i++) {
      const w = this.wheels[i];
      const conn = this.controller.wheelChassisConnectionPointCs(i);
      const len = this.controller.wheelSuspensionLength(i) ?? this.tuning.suspensionRest;
      if (conn) {
        w.x = conn.x;
        w.y = conn.y - len;
        w.z = conn.z;
      }
      w.steer = this.controller.wheelSteering(i) ?? 0;
      w.spin = this.controller.wheelRotation(i) ?? 0;
      w.contact = this.controller.wheelIsInContact(i);
      w.compression = clamp(1 - len / this.tuning.suspensionRest, 0, 1);

      if (w.contact) {
        const cp = this.controller.wheelContactPoint(i);
        if (cp) {
          w.contactX = cp.x;
          w.contactY = cp.y;
          w.contactZ = cp.z;
        }
        const n = this.controller.wheelContactNormal(i);
        if (n) {
          w.normalX = n.x;
          w.normalY = n.y;
          w.normalZ = n.z;
        }
      }
    }
  }

  /**
   * Rollover is a real mechanic with zero consequence (§2): let the tip happen,
   * hold the "whoa" beat, then set the truck gently back on its wheels facing
   * the way it was going. Never a fail state, never a reload, no lost ground.
   */
  private updateRollover(up: { x: number; y: number; z: number }, dt: number) {
    const t = this.tuning;

    // Left the heightfield entirely. Same treatment as a rollover: no fuss, no
    // penalty, just put the truck back on sand where it last made sense.
    if (this.body.translation().y < FALL_LIMIT) {
      this.recover('fell');
      return;
    }

    const rolled = up.y < t.rollThreshold;
    this.telemetry.rolledOver = rolled;

    if (rolled) {
      this.rolledTimer += dt;
      if (this.rolledTimer >= t.rollRecoverDelay) {
        this.recover('rollover');
      }
      return;
    }

    this.rolledTimer = 0;

    // Remember somewhere sane to be put back down, sampled sparsely.
    this.uprightSampleTimer += dt;
    if (this.uprightSampleTimer > 0.5 && up.y > 0.85) {
      this.uprightSampleTimer = 0;
      const p = this.body.translation();
      this.lastUprightPos = { x: p.x, y: p.y, z: p.z };
      const fwd = rotateVec(this.body.rotation(), { x: 0, y: 0, z: 1 });
      this.lastUprightYaw = Math.atan2(fwd.x, fwd.z);
    }
  }

  recover(reason: RecoverReason = 'manual') {
    const p = this.body.translation();
    // Recover in place where possible — being teleported backwards would read
    // as lost progress, which is exactly the punishment we're avoiding. Falling
    // off the edge is the one case where "in place" isn't a real location.
    const raw = reason === 'rollover' ? { x: p.x, z: p.z } : this.lastUprightPos;
    const target = {
      x: clamp(raw.x, -RECOVER_BOUND, RECOVER_BOUND),
      z: clamp(raw.z, -RECOVER_BOUND, RECOVER_BOUND),
    };
    const ground = heightAt(target.x, target.z);

    this.body.setTranslation({ x: target.x, y: ground + 1.6, z: target.z }, true);
    const half = this.lastUprightYaw / 2;
    this.body.setRotation({ w: Math.cos(half), x: 0, y: Math.sin(half), z: 0 }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.steerAngle = 0;
    this.rolledTimer = 0;
    this.onRecover?.(reason);
  }

  /**
   * Place the truck at a chosen spot and heading, upright and stopped. Used by
   * the world boundary to set the player back down inside the region facing the
   * centre. Like `recover`, it's damage-free and loses nothing but the drive out.
   */
  warpTo(x: number, z: number, yaw: number): void {
    const ground = heightAt(x, z);
    const y = ground + 1.6;
    this.body.setTranslation({ x, y, z }, true);
    const half = yaw / 2;
    this.body.setRotation({ w: Math.cos(half), x: 0, y: Math.sin(half), z: 0 }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.steerAngle = 0;
    this.rolledTimer = 0;
    this.lastUprightPos = { x, y, z };
    this.lastUprightYaw = yaw;
  }

  get position(): RAPIER.Vector {
    return this.body.translation();
  }

  get rotation(): RAPIER.Rotation {
    return this.body.rotation();
  }
}

function rotateVec(
  q: { w: number; x: number; y: number; z: number },
  v: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  // v + 2 * cross(q.xyz, cross(q.xyz, v) + q.w * v)
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
