import * as THREE from 'three';
import type { VehicleTelemetry } from '../vehicle/Vehicle';
import { clampAboveGround, minCameraY } from './cameraClearance';

const BASE_DISTANCE = 9.5;
const BASE_HEIGHT = 3.6;
const LOOK_AHEAD = 6.0;
const BASE_FOV = 62;
const SPEED_FOV = 12;

/**
 * Chase camera tuned to sell speed and weight rather than to track the car
 * rigidly. It leans on three things: it lags behind hard acceleration, it
 * widens with speed, and it stays level with the horizon instead of rolling
 * with the chassis — a camera that rolls with the body makes a sidehill read as
 * flat, which would hide the exact tension we're building the physics for.
 */
export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera;

  private position = new THREE.Vector3();
  private lookAt = new THREE.Vector3();
  private yaw = 0;
  private userYaw = 0;
  private initialized = false;

  private tmpForward = new THREE.Vector3();
  private tmpDesired = new THREE.Vector3();
  private tmpTarget = new THREE.Vector3();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(BASE_FOV, aspect, 0.3, 3000);
  }

  update(
    bodyPos: THREE.Vector3,
    bodyQuat: THREE.Quaternion,
    telemetry: VehicleTelemetry,
    orbitInput: number,
    dt: number,
  ) {
    this.userYaw += orbitInput * 1.8 * dt;
    // Ease the manual offset back to centre so the camera returns to the
    // driving view on its own.
    this.userYaw *= Math.exp(-1.2 * dt);

    this.tmpForward.set(0, 0, 1).applyQuaternion(bodyQuat);
    const bodyYaw = Math.atan2(this.tmpForward.x, this.tmpForward.z);

    if (!this.initialized) {
      this.yaw = bodyYaw;
      this.initialized = true;
    }

    // Follow the chassis yaw, but lazily — the lag is what makes a slide legible.
    const yawDelta = wrapAngle(bodyYaw - this.yaw);
    const yawFollow = 1 - Math.exp(-5.5 * dt);
    this.yaw += yawDelta * yawFollow;

    const aimYaw = this.yaw + this.userYaw;
    const speedFrac = Math.min(1, telemetry.speedKph / 110);

    // Pull back and up a touch with speed and airtime.
    const distance = BASE_DISTANCE + speedFrac * 2.2 + Math.min(telemetry.airtime, 1.5) * 1.8;
    const height = BASE_HEIGHT + Math.min(telemetry.airtime, 1.5) * 1.2;

    this.tmpDesired.set(
      bodyPos.x - Math.sin(aimYaw) * distance,
      bodyPos.y + height,
      bodyPos.z - Math.cos(aimYaw) * distance,
    );

    // Lift the *target* clear of the ground before smoothing, so the camera
    // eases up a rising dune rather than being shoved out of it after the fact.
    this.tmpDesired.y = Math.max(
      this.tmpDesired.y,
      minCameraY(this.tmpDesired.x, this.tmpDesired.z, bodyPos.x, bodyPos.y + 1.2, bodyPos.z),
    );

    // Positional lag: stiffer vertically so cresting a dune doesn't launch the
    // camera, looser horizontally so acceleration is felt as the world pulling away.
    const posFollow = 1 - Math.exp(-7.0 * dt);
    // Rising to clear terrain has to beat the smoothing, or a sharp ridge is
    // through the lens before the camera has finished easing over it. Dropping
    // back down stays lazy.
    const climbing = this.tmpDesired.y > this.position.y;
    const vertFollow = 1 - Math.exp((climbing ? -12.0 : -4.0) * dt);
    this.position.x += (this.tmpDesired.x - this.position.x) * posFollow;
    this.position.z += (this.tmpDesired.z - this.position.z) * posFollow;
    this.position.y += (this.tmpDesired.y - this.position.y) * vertFollow;

    // Hard floor. The smoothing above should almost always have handled it;
    // this is what guarantees the camera never actually ends up underground.
    this.position.y = clampAboveGround(this.position.x, this.position.y, this.position.z);

    this.tmpTarget.set(
      bodyPos.x + Math.sin(aimYaw) * LOOK_AHEAD,
      bodyPos.y + 1.2,
      bodyPos.z + Math.cos(aimYaw) * LOOK_AHEAD,
    );
    const lookFollow = 1 - Math.exp(-9.0 * dt);
    this.lookAt.lerp(this.tmpTarget, lookFollow);

    this.camera.position.copy(this.position);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.lookAt);

    const targetFov = BASE_FOV + speedFrac * SPEED_FOV;
    this.camera.fov += (targetFov - this.camera.fov) * (1 - Math.exp(-3.0 * dt));
    this.camera.updateProjectionMatrix();
  }

  /** Snap instantly — used after a rollover recovery so the cut isn't a swoop. */
  reset(bodyPos: THREE.Vector3, bodyQuat: THREE.Quaternion) {
    this.tmpForward.set(0, 0, 1).applyQuaternion(bodyQuat);
    this.yaw = Math.atan2(this.tmpForward.x, this.tmpForward.z);
    this.userYaw = 0;
    this.position.set(
      bodyPos.x - Math.sin(this.yaw) * BASE_DISTANCE,
      bodyPos.y + BASE_HEIGHT,
      bodyPos.z - Math.cos(this.yaw) * BASE_DISTANCE,
    );
    // A recovery can drop the truck into a hollow; the snapped camera has to
    // respect the terrain too or the first frame back is underground.
    this.position.y = Math.max(
      this.position.y,
      minCameraY(this.position.x, this.position.z, bodyPos.x, bodyPos.y + 1.2, bodyPos.z),
    );
    this.lookAt.copy(bodyPos);
    this.initialized = true;
  }

  setAspect(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
