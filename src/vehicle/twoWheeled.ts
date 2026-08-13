import type { WheelState } from './Vehicle';

/**
 * Collapsing a four-raycast axle onto its centre line.
 *
 * The physics gives every body four wheels at the shared hard-points, whatever
 * it looks like (see BACKLOG item 12). Anything downstream that reads wheel
 * contacts therefore produces a four-wheeler's output for the motorcycle unless
 * it merges the pairs first — two parallel ruts a track-width apart, and a dust
 * cloud as wide as a pickup's.
 *
 * This is the patch over that, not a fix for it. The real fix is per-body
 * wheel hard-points, which is the large risky item in the backlog.
 */
export function mergeAxle(a: WheelState, b: WheelState, out: WheelState): WheelState {
  // Both must be down. Averaging a contact with a non-contact drags the merged
  // point toward somewhere that isn't on the surface.
  out.contact = !!a?.contact && !!b?.contact;
  if (!out.contact) return out;

  out.contactX = (a.contactX + b.contactX) / 2;
  out.contactY = (a.contactY + b.contactY) / 2;
  out.contactZ = (a.contactZ + b.contactZ) / 2;
  out.normalX = (a.normalX + b.normalX) / 2;
  out.normalY = (a.normalY + b.normalY) / 2;
  out.normalZ = (a.normalZ + b.normalZ) / 2;
  const len = Math.hypot(out.normalX, out.normalY, out.normalZ) || 1;
  out.normalX /= len;
  out.normalY /= len;
  out.normalZ /= len;

  out.softness = (a.softness + b.softness) / 2;
  out.compression = (a.compression + b.compression) / 2;
  out.spin = a.spin;
  out.steer = a.steer;
  out.x = 0;
  out.y = (a.y + b.y) / 2;
  out.z = (a.z + b.z) / 2;
  return out;
}

export function emptyWheelState(): WheelState {
  return {
    x: 0, y: 0, z: 0, steer: 0, spin: 0, contact: false, compression: 0, softness: 0,
    contactX: 0, contactY: 0, contactZ: 0, normalX: 0, normalY: 1, normalZ: 0,
  };
}
