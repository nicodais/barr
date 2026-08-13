import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  emptyRoutePoint, routeLead, routeScale, sampleRoute, type Route, type RoutePoint,
} from './routes';

/**
 * Other people, out there in the dark.
 *
 * Night already works — the headlights turned it from a screensaver back into
 * driving — but it is the emptiest the game ever feels, and empty is not the
 * same as solitary. §1 wants alone-*ish*: Ahmed keeps half an eye on "the
 * dune-bashing traffic in his patch", and until now that traffic did not exist,
 * which quietly made him a man radioing about nobody.
 *
 * A string of headlights crossing a ridge two kilometres off fixes that for
 * almost nothing. It reads instantly — everyone knows what a line of 4x4s at
 * night looks like — it gives the dark a depth cue nothing else provides, and
 * it never asks anything of the player. You are not meant to catch them.
 *
 * ## Why they are lights first and vehicles second
 *
 * At the distances these run, a correctly-scaled headlight is a fraction of a
 * pixel and simply is not there. So the lamp glows are drawn as camera-facing
 * quads that *grow with distance* — the standard trick, and the only reason
 * distant lights read at all — while the bodies stay true scale and are
 * effectively invisible until you get close. Get close anyway and you find a
 * plain dark 4x4 driving along, which is the honest answer to "what is that".
 *
 * The glows are also exempt from fog, deliberately. Everything else in the
 * world dissolves into haze at the draw distance; headlights are the one thing
 * that genuinely punches through it, and letting them do that is what puts
 * something *beyond* the fog wall at night.
 *
 * Facing is worth the four lines it costs: white brightens as a convoy comes at
 * you and dies as it turns away, red does the opposite. Without it you get four
 * lamps of equal brightness from every angle, which reads as floating markers.
 */

/** Metres between vehicles, nose to tail. Convoys out here run close. */
const SPACING = 19;
/** Below this much night, they are not on the road at all. */
const NIGHT_ON = 0.12;

/**
 * Three convoys, all well out toward the boundary. Nothing here is placed near
 * a POI: these are meant to be somewhere else, permanently.
 */
const ROUTES: Route[] = [
  { cx: 250, cz: -430, major: 340, minor: 46, bearing: 0.5, count: 4, speed: 11, phase: 0.0, direction: 1 },
  { cx: -460, cz: -180, major: 260, minor: 34, bearing: 2.2, count: 3, speed: 9, phase: 1.9, direction: -1 },
  { cx: 120, cz: 520, major: 240, minor: 58, bearing: 1.1, count: 5, speed: 13, phase: 3.4, direction: 1 },
];

/** Lamp positions on the body, relative to its centre at ground level. */
const LAMPS = [
  { x: 0.66, y: 0.95, z: 2.05, front: true },
  { x: -0.66, y: 0.95, z: 2.05, front: true },
  { x: 0.72, y: 0.95, z: -2.05, front: false },
  { x: -0.72, y: 0.95, z: -2.05, front: false },
];

const WHITE = new THREE.Color(0xffeccb);
const RED = new THREE.Color(0xff4a2a);

export class Convoys {
  readonly group = new THREE.Group();

  private bodies: THREE.InstancedMesh;
  private glows: THREE.InstancedMesh;
  private bodyGeo: THREE.BufferGeometry;
  private glowGeo: THREE.CircleGeometry;
  private bodyMat: THREE.MeshLambertMaterial;
  private glowMat: THREE.MeshBasicMaterial;

  private dummy = new THREE.Object3D();
  private tint = new THREE.Color();
  private toCam = new THREE.Vector3();
  private point: RoutePoint = emptyRoutePoint();
  private t = 0;
  /** Routes currently switched on, from the quality tier. */
  private routes = ROUTES.length;

  private static readonly MAX_VEHICLES = ROUTES.reduce((n, r) => n + r.count, 0);

  constructor() {
    this.bodyGeo = buildAnonymousBody(0x2f2b28);
    this.bodyMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.bodies = new THREE.InstancedMesh(this.bodyGeo, this.bodyMat, Convoys.MAX_VEHICLES);
    this.bodies.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.bodies.frustumCulled = false;
    this.bodies.castShadow = false;

    this.glowGeo = new THREE.CircleGeometry(1, 8);
    this.glowMat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      // The one thing in the world allowed to survive the haze — see above.
      fog: false,
    });
    this.glows = new THREE.InstancedMesh(
      this.glowGeo, this.glowMat, Convoys.MAX_VEHICLES * LAMPS.length,
    );
    this.glows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.glows.frustumCulled = false;
    // Drawn after the terrain but still depth-tested, so a convoy behind a dune
    // is behind the dune rather than shining through it.
    this.glows.renderOrder = 9;

    this.group.add(this.bodies, this.glows);
    this.group.visible = false;
  }

  /** Number of routes to run. Zero switches the system off entirely. */
  setRoutes(n: number) {
    this.routes = Math.max(0, Math.min(ROUTES.length, n));
  }

  /** @param night 0..1 off the day curve. */
  update(dt: number, night: number, camera: THREE.Vector3) {
    const on = night > NIGHT_ON && this.routes > 0;
    this.group.visible = on;
    if (!on) return;

    // Eased so they arrive with the dark rather than snapping on at a threshold.
    const fade = Math.min(1, (night - NIGHT_ON) / 0.3);
    this.t += dt;

    let v = 0;
    let g = 0;
    for (let r = 0; r < this.routes; r++) {
      const route = ROUTES[r];
      const mean = routeScale(route);
      const lead = routeLead(route, this.t);

      for (let i = 0; i < route.count; i++) {
        const u = lead - (i * SPACING * route.direction) / mean;
        const p = sampleRoute(route, u, this.point);
        const { x, z, y, fx, fz, yaw, pitch } = p;

        this.dummy.position.set(x, y, z);
        this.dummy.rotation.set(pitch, yaw, 0, 'YXZ');
        this.dummy.scale.setScalar(1);
        this.dummy.updateMatrix();
        this.bodies.setMatrixAt(v++, this.dummy.matrix);

        // How square-on this vehicle is to the camera, +1 coming at you.
        this.toCam.set(camera.x - x, 0, camera.z - z);
        const dist = this.toCam.length() || 1;
        const facing = (this.toCam.x * fx + this.toCam.z * fz) / dist;
        // Sub-pixel at range unless it grows: this is what makes them read.
        const size = 0.34 + dist * 0.0075;

        for (const lamp of LAMPS) {
          // Rotate the lamp offset into world space by the vehicle's yaw.
          const lx = x + (lamp.x * Math.cos(yaw) + lamp.z * Math.sin(yaw));
          const lz = z + (-lamp.x * Math.sin(yaw) + lamp.z * Math.cos(yaw));
          this.dummy.position.set(lx, y + lamp.y, lz);
          // Object3D.lookAt points +Z at the target for non-cameras, which is
          // exactly the face of a CircleGeometry. Building the matrix by hand
          // is the same call with eye and target swapped, and gets it backwards.
          this.dummy.lookAt(camera);
          this.dummy.scale.setScalar(size * (lamp.front ? 1 : 0.72));
          this.dummy.updateMatrix();
          this.glows.setMatrixAt(g, this.dummy.matrix);

          // Headlights are bright from ahead and nothing from behind; tail
          // lamps the reverse. Never fully off — a real convoy still scatters
          // enough light off its own dust to be a smudge from any angle.
          const aim = lamp.front ? facing : -facing;
          const k = (0.16 + 0.84 * Math.max(0, aim)) * fade;
          this.glows.setColorAt(g, this.tint.copy(lamp.front ? WHITE : RED).multiplyScalar(k));
          g++;
        }
      }
    }

    this.bodies.count = v;
    this.glows.count = g;
    this.bodies.instanceMatrix.needsUpdate = true;
    this.glows.instanceMatrix.needsUpdate = true;
    if (this.glows.instanceColor) this.glows.instanceColor.needsUpdate = true;
  }

  dispose() {
    this.bodyGeo.dispose();
    this.glowGeo.dispose();
    this.bodyMat.dispose();
    this.glowMat.dispose();
    this.bodies.dispose();
    this.glows.dispose();
  }
}

/**
 * A generic 4x4 in five boxes, origin at ground level between the wheels.
 *
 * Kept anonymous on purpose. These are other people, and giving them one of the
 * player's own bodies would raise the question of which one — and then of why
 * you can't catch it. Shared with the daytime traffic for the same reason.
 */
export function buildAnonymousBody(paint = 0x6d5f52): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  /** Paint a part a flat colour, move it into place, and keep it. */
  const at = (g: THREE.BufferGeometry, colour: number, x: number, y: number, z: number) => {
    g.translate(x, y, z);
    const n = g.toNonIndexed();
    g.dispose();
    const count = n.getAttribute('position').count;
    const c = new Float32Array(count * 3);
    const col = new THREE.Color(colour);
    for (let i = 0; i < count; i++) {
      c[i * 3] = col.r;
      c[i * 3 + 1] = col.g;
      c[i * 3 + 2] = col.b;
    }
    n.setAttribute('color', new THREE.BufferAttribute(c, 3));
    parts.push(n);
    return n;
  };

  const glass = 0x2b3138;
  const trim = 0x3b352f;
  const rubber = 0x1b1a19;

  // Chassis rail and the lower body, slightly narrower than the tub above it so
  // the silhouette has a shoulder rather than being one slab.
  at(new THREE.BoxGeometry(1.72, 0.30, 4.24), trim, 0, 0.66, 0);
  at(new THREE.BoxGeometry(1.88, 0.62, 4.12), paint, 0, 1.06, 0);
  // Cab: a glass band with a roof over it, which is what actually makes this
  // read as a vehicle rather than a crate at any distance you can see it.
  at(new THREE.BoxGeometry(1.76, 0.46, 2.30), glass, 0, 1.56, -0.22);
  at(new THREE.BoxGeometry(1.80, 0.16, 2.36), paint, 0, 1.86, -0.22);
  // Bonnet, forward of the cab and lower than it.
  at(new THREE.BoxGeometry(1.80, 0.34, 1.30), paint, 0, 1.54, 1.42);
  // Bumpers.
  at(new THREE.BoxGeometry(1.94, 0.22, 0.24), trim, 0, 0.80, 2.10);
  at(new THREE.BoxGeometry(1.94, 0.22, 0.24), trim, 0, 0.80, -2.10);

  // Wheels. Twelve segments, not six: at six a wheel is a hexagon, and the
  // player *can* drive up to these — the first pass was built on the assumption
  // that nobody ever would, and it read as a broken prop the moment somebody
  // did.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const w = new THREE.CylinderGeometry(0.46, 0.46, 0.34, 12);
      w.rotateZ(Math.PI / 2);
      at(w, rubber, sx * 0.86, 0.46, sz * 1.42);
      // Arch over each wheel, so the body doesn't just float above them.
      at(new THREE.BoxGeometry(0.26, 0.30, 1.16), trim, sx * 0.92, 0.92, sz * 1.42);
    }
  }

  // Every part is non-indexed and carries a colour attribute, so the sets match
  // and the merge cannot silently return null.
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  return merged ?? new THREE.BoxGeometry(1.88, 1.7, 4.24);
}
