import { heightAt } from '../terrain/height';

/**
 * Keeping cameras out of the ground.
 *
 * Two separate failures look the same from the driver's seat. The camera can sit
 * below the surface outright — easy, just clamp its height. Or the ground can
 * stay below the camera while a ridge *between* the camera and the truck pokes
 * through the view, which no amount of clamping the camera's own position
 * fixes. Both are handled here by asking how high the camera has to be for the
 * straight line back to its subject to clear the terrain the whole way.
 */

/** Comfortably clear of the 0.3m near plane, so nothing slices open. */
export const CAMERA_CLEARANCE = 1.5;

/**
 * How far the camera may be pushed up. Driving hard into a steep bank can
 * demand an almost vertical view; past this it's better to accept a clipped
 * corner than to fling the camera into orbit.
 */
const MAX_LIFT = 26;

/** Samples along the sight line. More is smoother, but this is per-frame. */
const SAMPLES = 6;

/**
 * Lowest height the camera can occupy and still see its target cleanly.
 *
 * @param targetY the point being looked at, already raised to eye height
 */
export function minCameraY(
  camX: number,
  camZ: number,
  targetX: number,
  targetY: number,
  targetZ: number,
): number {
  let required = heightAt(camX, camZ) + CAMERA_CLEARANCE;

  for (let i = 1; i < SAMPLES; i++) {
    const t = i / SAMPLES;
    const x = targetX + (camX - targetX) * t;
    const z = targetZ + (camZ - targetZ) * t;
    const clearHere = heightAt(x, z) + CAMERA_CLEARANCE;

    // The sight line reads targetY + (camY - targetY) * t at this point, so the
    // camera height that would just graze the terrain here is:
    const needed = targetY + (clearHere - targetY) / t;
    if (needed > required) required = needed;
  }

  return Math.min(required, targetY + MAX_LIFT);
}

/** Hard floor for a camera that's already been placed. */
export function clampAboveGround(x: number, y: number, z: number): number {
  return Math.max(y, heightAt(x, z) + CAMERA_CLEARANCE);
}
