import { heightAt } from '../terrain/height';

/**
 * The path other people drive on, shared by the night convoys and the daytime
 * traffic.
 *
 * Both systems need the same four things — a position on a loop, a heading, the
 * ground under it, and a pitch that leans into the climb — and both need them
 * from the *analytic* tangent rather than from last frame's position. A finite
 * difference at these speeds jitters the yaw by a fraction of a degree per
 * frame, which is invisible on the body and very visible on anything attached
 * to it: it made the night lamps flicker, and it makes a dust plume shear.
 *
 * Flat ellipses, not circles. An out-and-back run along a ridge is what people
 * actually do out here, and a vehicle visibly driving in a circle is the one
 * thing that would break the illusion outright.
 */
export interface Route {
  cx: number;
  cz: number;
  /** Long and short axes of the loop. */
  major: number;
  minor: number;
  /** Rotation of the long axis, radians. */
  bearing: number;
  count: number;
  /** Metres per second along the path. */
  speed: number;
  phase: number;
  direction: number;
}

export interface RoutePoint {
  x: number;
  z: number;
  /** Ground height at (x, z). */
  y: number;
  /** Unit heading. */
  fx: number;
  fz: number;
  yaw: number;
  pitch: number;
}

/** Mean radius, used as the circumference basis so a spacing in metres can be
 *  turned into an offset in the path parameter. Crude and adequate. */
export function routeScale(route: Route): number {
  return (route.major + route.minor) / 2;
}

/** Where the lead vehicle is at time `t`, as a path parameter. */
export function routeLead(route: Route, t: number): number {
  return route.phase + (t * route.speed * route.direction) / routeScale(route);
}

/**
 * Sample the loop at parameter `u`.
 *
 * @param wheelbase how far ahead to read the ground for the pitch. Longer for a
 *   plume's tail sample than for a body, since a plume does not have wheels and
 *   only needs the ground to sit on.
 */
export function sampleRoute(route: Route, u: number, out: RoutePoint, wheelbase = 2.9): RoutePoint {
  const cb = Math.cos(route.bearing);
  const sb = Math.sin(route.bearing);
  const cu = Math.cos(u);
  const su = Math.sin(u);

  out.x = route.cx + route.major * cu * cb - route.minor * su * sb;
  out.z = route.cz + route.major * cu * sb + route.minor * su * cb;

  const dx = (-route.major * su * cb - route.minor * cu * sb) * route.direction;
  const dz = (-route.major * su * sb + route.minor * cu * cb) * route.direction;
  const len = Math.hypot(dx, dz) || 1;
  out.fx = dx / len;
  out.fz = dz / len;
  out.yaw = Math.atan2(out.fx, out.fz);

  out.y = heightAt(out.x, out.z);
  const ahead = heightAt(out.x + out.fx * wheelbase, out.z + out.fz * wheelbase);
  out.pitch = -Math.atan2(ahead - out.y, wheelbase);
  return out;
}

export function emptyRoutePoint(): RoutePoint {
  return { x: 0, z: 0, y: 0, fx: 0, fz: 1, yaw: 0, pitch: 0 };
}

/**
 * Position and ground height only — no tangent, no look-ahead sample.
 *
 * The daytime plumes need a few hundred of these per frame and none of them
 * need a heading, so this exists to keep that off the two `heightAt` calls per
 * sample that `sampleRoute` costs.
 */
export function routeGround(
  route: Route,
  u: number,
  out: { x: number; y: number; z: number },
): void {
  const cb = Math.cos(route.bearing);
  const sb = Math.sin(route.bearing);
  const cu = Math.cos(u);
  const su = Math.sin(u);
  out.x = route.cx + route.major * cu * cb - route.minor * su * sb;
  out.z = route.cz + route.major * cu * sb + route.minor * su * cb;
  out.y = heightAt(out.x, out.z);
}
