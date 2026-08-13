import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  AXLE_HEIGHT,
  HALF_TRACK,
  HALF_WHEELBASE,
  WHEEL_RADIUS,
  WHEEL_WIDTH,
} from './VehicleTuning';
import type { WheelState } from './Vehicle';
import {
  DEFAULT_VEHICLE,
  paintColor,
  type BodyId,
  type VehicleConfig,
  type WheelStyleId,
} from './vehicleConfig';

/**
 * The truck, in four bodies: a boxy live-axle-era 4x4 built from primitives in
 * the flat-shaded style (§4).
 *
 * Proportions follow a Patrol Super Safari as a *visual reference only* — every
 * piece here is built from primitives in-house, and there is deliberately no
 * badging or maker's mark of any kind, because §11 rules out reproducing
 * trademarked identifiers even when the silhouette is the thing being evoked.
 *
 * Every body hangs on the same collider, wheelbase and track (VehicleTuning):
 * the garage is a paint-and-panels choice, never a handling one.
 *
 * All the static bodywork is merged down to one mesh per material, so the whole
 * vehicle costs a handful of draw calls instead of the ~60 it takes to build.
 * Only the wheels stay separate, because they steer and spin.
 */
export interface VehicleView {
  root: THREE.Group;
  wheels: THREE.Group[];
  /** @param speed m/s, used only by two-wheelers for lean. */
  update(wheels: WheelState[], speed?: number): void;
  /**
   * Every geometry and material here is built per view, because paint is baked
   * into the materials and bodywork into the merged geometry. Rebuilding on a
   * garage change without this leaks a whole truck's worth of GPU buffers each
   * time the player tries a colour.
   */
  dispose(): void;
}

// Warm, limited, and readable against ochre sand (§4). Body colour is the one
// entry the player picks; everything else is shared trim.
const FIXED_PALETTE = {
  glass: 0xdb9a4e,
  trim: 0x24262a,
  rubber: 0x1e2022,
  // Muted rather than bright: at a low sun a near-white bumper blows out to a
  // flat white block and reads as missing geometry.
  chrome: 0x8f9499,
  steel: 0x8d939a,
  lamp: 0xf3ead6,
  amber: 0xd9822b,
  brake: 0xa8342c,
  cargo: 0x49543f,
};

function mat(color: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, flatShading: true });
}

/**
 * Glass carries an emissive term rather than being lit normally. The reference
 * treats every window as one flat amber fill, and under plain Lambert shading a
 * windscreen angled away from a low sun goes almost black — which reads as a
 * hole in the truck rather than a window.
 */
function glassMat(): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({
    color: FIXED_PALETTE.glass,
    emissive: 0x6b4518,
    flatShading: true,
  });
}

type Materials = ReturnType<typeof createMaterials>;
type MatKey = keyof Materials;

function createMaterials(paint: number) {
  // The shadow-side body colour is derived rather than authored per swatch: it
  // has to stay a plausible shade of whatever the player picked, and eight
  // hand-paired darks would drift out of step the moment a swatch is retuned.
  const dark = new THREE.Color(paint).multiplyScalar(0.74);
  return {
    body: mat(paint),
    bodyDark: mat(dark.getHex()),
    glass: glassMat(),
    trim: mat(FIXED_PALETTE.trim),
    rubber: mat(FIXED_PALETTE.rubber),
    chrome: mat(FIXED_PALETTE.chrome),
    steel: mat(FIXED_PALETTE.steel),
    lamp: mat(FIXED_PALETTE.lamp),
    amber: mat(FIXED_PALETTE.amber),
    brake: mat(FIXED_PALETTE.brake),
    cargo: mat(FIXED_PALETTE.cargo),
  };
}

/** Collects transformed geometry per material so it can be merged in one pass. */
class PartBuilder {
  private parts = new Map<MatKey, THREE.BufferGeometry[]>();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);

  constructor(private materials: Materials) {}

  add(
    geo: THREE.BufferGeometry,
    key: MatKey,
    pos: [number, number, number],
    rot?: [number, number, number],
  ) {
    this.e.set(rot?.[0] ?? 0, rot?.[1] ?? 0, rot?.[2] ?? 0);
    this.q.setFromEuler(this.e);
    this.v.set(pos[0], pos[1], pos[2]);
    this.m.compose(this.v, this.q, this.one);
    geo.applyMatrix4(this.m);

    let list = this.parts.get(key);
    if (!list) {
      list = [];
      this.parts.set(key, list);
    }
    list.push(geo);
  }

  /** Mirrors a part to the other side of the vehicle. */
  addPair(
    make: () => THREE.BufferGeometry,
    key: MatKey,
    pos: [number, number, number],
    rot?: [number, number, number],
  ) {
    this.add(make(), key, pos, rot);
    this.add(make(), key, [-pos[0], pos[1], pos[2]], rot ? [rot[0], -rot[1], -rot[2]] : undefined);
  }

  /**
   * A tube spanning two points.
   *
   * Placing tubes by centre-plus-Euler-angle is how the cage kept coming out
   * wrong: the length, the midpoint and the angle all have to be derived from
   * the two joints by hand, they have to agree, and when they don't you get a
   * bar that starts in the right place, points the wrong way and stops short of
   * whatever it was supposed to reach. Three separate members of the roll cage
   * shipped like that. Stating the endpoints instead makes "this tube connects
   * these two joints" the thing that's written down, and the arithmetic can't
   * drift out of step with it.
   */
  strut(
    key: MatKey,
    from: [number, number, number],
    to: [number, number, number],
    radius = 0.045,
  ) {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const dz = to[2] - from[2];
    const len = Math.hypot(dx, dy, dz);
    const geo = new THREE.CylinderGeometry(radius, radius, len, 6);
    // Cylinders are built along +Y, so rotate that axis onto the span.
    strutFrom.set(0, 1, 0);
    strutTo.set(dx / len, dy / len, dz / len);
    strutQ.setFromUnitVectors(strutFrom, strutTo);
    geo.applyQuaternion(strutQ);
    this.add(geo, key, [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2]);
  }

  /** The same tube, mirrored to both sides. */
  strutPair(
    key: MatKey,
    from: [number, number, number],
    to: [number, number, number],
    radius = 0.045,
  ) {
    this.strut(key, from, to, radius);
    this.strut(key, [-from[0], from[1], from[2]], [-to[0], to[1], to[2]], radius);
  }

  build(): THREE.Mesh[] {
    const meshes: THREE.Mesh[] = [];
    for (const [key, geos] of this.parts) {
      // Normalise to non-indexed first. `mergeGeometries` returns null the
      // moment one part in a bucket carries an index buffer and another
      // doesn't, and this builder mixes both: Box and Cylinder are indexed,
      // the lofted shells are not. Unnormalised, the first lofted body
      // silently deleted every part sharing its material — the whole
      // bodywork bucket — and the truck rendered as wheels and lamps.
      // ...and drop every attribute but position and normal while we're here.
      // The same merge is equally strict about attribute *sets*, and three's
      // primitives ship a `uv` the lofted shells have no reason to generate.
      // Nothing in this file is textured — every material is a flat colour — so
      // the UVs are dead weight that only exists to break the merge.
      const flat = geos.map((g) => {
        const n = g.index ? g.toNonIndexed() : g;
        if (n !== g) g.dispose();
        for (const name of Object.keys(n.attributes)) {
          if (name !== 'position' && name !== 'normal') n.deleteAttribute(name);
        }
        return n;
      });
      const merged = mergeGeometries(flat, false);
      // The source geometries are transient scratch: merging copies their data,
      // so holding them any longer just pins buffers no mesh will ever draw.
      for (const g of flat) g.dispose();
      if (!merged) {
        console.warn(`[dune] vehicle merge dropped the "${key}" bucket`);
        continue;
      }
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, this.materials[key]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      meshes.push(mesh);
    }
    return meshes;
  }
}

const strutFrom = new THREE.Vector3();
const strutTo = new THREE.Vector3();
const strutQ = new THREE.Quaternion();

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
/** Cage/bar tubing. Six sides is plenty at this scale and keeps the facet look. */
const tube = (len: number, r = 0.045) => new THREE.CylinderGeometry(r, r, len, 6);
/** A wheel-shaped cylinder, axis along Z, for spares. */
function disc(radius: number, width: number, segments: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(radius, radius, width, segments);
  g.rotateX(Math.PI / 2);
  return g;
}

// --- key dimensions -----------------------------------------------------------
// These describe the *bodywork* and are free to overhang the collider — bumpers,
// flares and the tailgate spare all stick out past it, exactly as they would on
// the real thing. The physics box is unchanged.
const BODY_HALF_W = 0.92;
/** Ground line relative to the body origin: static hub height less the tyre. */
const GROUND_Y = AXLE_HEIGHT - 0.4 - WHEEL_RADIUS;
/** Radians of lean at full lock and speed. About 27 degrees — enough to read
 *  from the chase camera, short of the angle that looks like a crash. */
const MAX_LEAN = 0.48;

/**
 * A body is now just its builder. The bolt-on accessories this used to carry
 * mounting points for are gone: five toggles multiplying four bodies meant
 * every silhouette had to survive 32 combinations, which pushed each one toward
 * a shape generic enough to hang anything off. Fewer, more committed vehicles
 * beat more permutations of a vague one.
 */
interface BodySpec {
  build(b: PartBuilder): void;
  /**
   * Draw two wheels on the centreline instead of four at the corners.
   *
   * The *physics* stays on four raycasts either way — the collider and the
   * wheel hard-points are fixed in VehicleTuning and never rebuilt on a body
   * change. So a two-wheeler here is a visual treatment of the same chassis:
   * each drawn wheel sits at the average of its axle pair, which keeps
   * articulation readable (the wheel still rises and falls) and quietly buys
   * the thing car-like stability it has no business having. That trade is the
   * only reason a bike is possible at all inside this footprint, and it is
   * worth being honest that it is a trade.
   */
  twoWheeled?: boolean;
  /** Lateral squash on the drawn wheel. A bike tyre is not a truck tyre. */
  wheelWidth?: number;
}

export function createVehicleView(config: VehicleConfig = DEFAULT_VEHICLE): VehicleView {
  const root = new THREE.Group();
  const materials = createMaterials(paintColor(config.paint));
  const b = new PartBuilder(materials);
  const spec = BODIES[config.body];
  const twoWheeled = spec.twoWheeled === true;

  spec.build(b);

  /**
   * Everything hangs off a pivot at ground level so a two-wheeler can lean.
   *
   * A bike rolls about its contact patch, not about its centre of mass — lean
   * it about the body origin and the wheels swing sideways out from under it.
   * So `lean` sits on the ground line and `hull` puts its children back into
   * body space. Four-wheelers get the same two groups and simply never rotate
   * them, which is cheaper than branching every transform below.
   */
  const lean = new THREE.Group();
  lean.position.y = GROUND_Y;
  const hull = new THREE.Group();
  hull.position.y = -GROUND_Y;
  lean.add(hull);
  root.add(lean);

  const bodyMeshes = b.build();
  for (const mesh of bodyMeshes) hull.add(mesh);

  // --- wheels ---------------------------------------------------------------
  const wheelGeos = buildWheelGeometry(config.wheels);

  const wheels: THREE.Group[] = [];
  for (let i = 0; i < (twoWheeled ? 2 : 4); i++) {
    // Outer group carries steering + suspension position, inner carries spin.
    const steerGroup = new THREE.Group();
    const spinGroup = new THREE.Group();

    const tyre = new THREE.Mesh(wheelGeos.tyre, materials.rubber);
    tyre.castShadow = true;
    spinGroup.add(tyre);

    const rim = new THREE.Mesh(wheelGeos.rim, materials.steel);
    rim.castShadow = true;
    spinGroup.add(rim);

    if (spec.wheelWidth !== undefined) spinGroup.scale.x = spec.wheelWidth;
    steerGroup.add(spinGroup);
    steerGroup.userData.spin = spinGroup;
    hull.add(steerGroup);
    wheels.push(steerGroup);
  }

  // Live axles, visible under the truck when it articulates. A bike has none,
  // and drawing a beam across a chassis whose width it does not admit to would
  // give the whole trick away.
  const axleGeo = box(HALF_TRACK * 2 - 0.12, 0.13, 0.13);
  const axles = twoWheeled ? [] : [0, 1].map(() => {
    const m = new THREE.Mesh(axleGeo, materials.trim);
    hull.add(m);
    return m;
  });

  return {
    root,
    wheels,
    update(wheelStates: WheelState[], speed = 0) {
      if (twoWheeled) {
        // Each drawn wheel is the mean of its axle pair, pulled onto x=0.
        for (let i = 0; i < wheels.length; i++) {
          const a = wheelStates[i * 2];
          const c = wheelStates[i * 2 + 1];
          if (!a || !c) continue;
          const g = wheels[i];
          g.position.set(0, (a.y + c.y) / 2, (a.z + c.z) / 2);
          g.rotation.y = (a.steer + c.steer) / 2;
          (g.userData.spin as THREE.Group).rotation.x = a.spin;
        }
        // Lean into the corner, scaled by speed so a bike stood still with the
        // bars turned doesn't lie down. Positive steer is a left turn and +X is
        // the left side, so the roll has to be negative to go with it.
        const steer = wheelStates[0] ? wheelStates[0].steer : 0;
        const want = -steer * Math.min(1, speed / 11) * MAX_LEAN;
        lean.rotation.z += (want - lean.rotation.z) * 0.16;
      } else {
        for (let i = 0; i < wheels.length && i < wheelStates.length; i++) {
          const s = wheelStates[i];
          const g = wheels[i];
          g.position.set(s.x, s.y, s.z);
          g.rotation.y = s.steer;
          (g.userData.spin as THREE.Group).rotation.x = s.spin;
        }
      }
      const pairs: Array<[number, number]> = [[0, 1], [2, 3]];
      if (twoWheeled) return;
      for (let a = 0; a < axles.length; a++) {
        const [l, r] = pairs[a];
        const ls = wheelStates[l];
        const rs = wheelStates[r];
        if (!ls || !rs) continue;
        axles[a].position.set(0, (ls.y + rs.y) / 2, (ls.z + rs.z) / 2);
        axles[a].rotation.z = Math.atan2(rs.y - ls.y, rs.x - ls.x);
      }
    },
    dispose() {
      root.clear();
      for (const mesh of bodyMeshes) mesh.geometry.dispose();
      wheelGeos.tyre.dispose();
      wheelGeos.rim.dispose();
      axleGeo.dispose();
      for (const m of Object.values(materials)) m.dispose();
    },
  };
}

// --- shared bodywork ----------------------------------------------------------


function buildFront(b: PartBuilder, noseZ: number, width = 1.94) {
  // Grille: a dark recess with slats catching a little light across it.
  b.add(box(0.98, 0.3, 0.07), 'rubber', [0, 0.13, noseZ + 0.015]);
  for (let i = 0; i < 3; i++) {
    b.add(box(0.92, 0.03, 0.04), 'trim', [0, 0.03 + i * 0.1, noseZ + 0.045]);
  }

  // Headlamps sit in dark surrounds outboard of the grille, indicators beyond.
  b.addPair(() => box(0.3, 0.24, 0.05), 'trim', [0.66, 0.14, noseZ + 0.015]);
  b.addPair(() => box(0.24, 0.17, 0.05), 'lamp', [0.66, 0.14, noseZ + 0.04]);
  b.addPair(() => box(0.1, 0.13, 0.05), 'amber', [0.86, 0.13, noseZ + 0.03]);

  // Bumper with a valance under it.
  b.add(box(width, 0.24, 0.3), 'chrome', [0, -0.28, noseZ + 0.06]);
  b.add(box(width - 0.14, 0.2, 0.2), 'trim', [0, -0.48, noseZ + 0.02]);
  b.add(box(width - 0.08, 0.12, 0.06), 'bodyDark', [0, -0.12, noseZ + 0.04]);
}

function buildRearLamps(b: PartBuilder, tailZ: number) {
  // Vertical lamp clusters: brake over reverse over indicator.
  for (const side of [1, -1]) {
    b.add(box(0.2, 0.2, 0.06), 'brake', [side * 0.72, 0.16, tailZ - 0.03]);
    b.add(box(0.2, 0.1, 0.06), 'lamp', [side * 0.72, -0.0, tailZ - 0.03]);
    b.add(box(0.2, 0.16, 0.06), 'amber', [side * 0.72, -0.14, tailZ - 0.03]);
  }

  b.add(box(1.94, 0.24, 0.28), 'chrome', [0, -0.28, tailZ - 0.06]);
  b.add(box(0.42, 0.2, 0.04), 'lamp', [0.0, -0.12, tailZ - 0.04]);
}

/** Black plastic arches and rock sliders. */
function buildArchesAndSteps(b: PartBuilder) {
  // Static wheel centre — the flares are body-mounted, so they stay put while
  // the wheels travel, which is what makes articulation read.
  const hubY = AXLE_HEIGHT - 0.4;

  for (const z of [HALF_WHEELBASE, -HALF_WHEELBASE]) {
    b.addPair(
      () => {
        // Half torus, axis along X: a chunky arch lip proud of the flank.
        const g = new THREE.TorusGeometry(0.58, 0.085, 4, 10, Math.PI);
        g.rotateY(Math.PI / 2);
        return g;
      },
      'trim',
      [BODY_HALF_W - 0.03, hubY, z],
    );
    // Fills the corner between arch and body so there's no gap at the top.
    b.addPair(() => box(0.16, 0.34, 1.16), 'trim', [BODY_HALF_W - 0.05, hubY + 0.42, z]);
  }

  // Rock sliders between the arches.
  b.addPair(() => box(0.13, 0.14, 1.5), 'trim', [BODY_HALF_W - 0.02, -0.52, 0]);
  b.addPair(() => box(0.2, 0.06, 1.3), 'trim', [BODY_HALF_W + 0.02, -0.58, 0]);
}

/** Mirrors on stalks at the A-pillar, plus a wiper for scale. */
function buildMirrors(b: PartBuilder, z: number, y: number) {
  b.addPair(() => box(0.14, 0.03, 0.03), 'trim', [1.0, y, z]);
  b.addPair(() => box(0.06, 0.16, 0.11), 'trim', [1.07, y, z]);
}

// --- lofted volumes -----------------------------------------------------------

/**
 * One cross-section of a lofted volume: a chamfered rectangle at a station
 * along Z.
 */
interface Station {
  z: number;
  /** Half width. */
  hw: number;
  /** Floor and roof of the section. */
  y0: number;
  y1: number;
  /** Corner cut. Zero gives a hard box; anything else gives a bevel. */
  c?: number;
  /** Lateral offset, for volumes that don't sit on the centreline. */
  x?: number;
}

/**
 * Lofts a run of stations into one shell.
 *
 * This is the single biggest thing separating these vehicles from the boxes
 * they replaced. A car body is a *tapered* volume — it narrows toward the nose,
 * tucks in at the tail, and the roof pulls in above the waist — and none of
 * that can be built by stacking axis-aligned boxes. Stacked boxes give you
 * coincident faces, hard steps where panels should flow, and a silhouette made
 * of right angles, which is why the first attempt read as toy bricks rather
 * than as a vehicle.
 *
 * The chamfer matters as much as the taper. Under flat shading every bevel is
 * an extra facet that catches the sun at its own angle, so a chamfered edge
 * reads as a highlight line down the body — the thing that makes low-poly work
 * look modelled instead of blocked out. It costs eight verts a station.
 *
 * Output is non-indexed so `flatShading` gives each facet its own hard normal.
 */
function loft(stations: Station[], capFront = true, capBack = true): THREE.BufferGeometry {
  const rings = stations.map((s) => {
    const c = s.c ?? 0;
    const x = s.x ?? 0;
    const { hw, y0, y1 } = s;
    // Counter-clockwise in XY, starting on the right flank. Winding is what
    // decides which way the normals point, so it is not arbitrary.
    return [
      [x + hw, y0 + c], [x + hw, y1 - c],
      [x + hw - c, y1], [x - hw + c, y1],
      [x - hw, y1 - c], [x - hw, y0 + c],
      [x - hw + c, y0], [x + hw - c, y0],
    ].map(([px, py]) => [px, py, s.z] as [number, number, number]);
  });

  const verts: number[] = [];
  const tri = (a: number[], b: number[], c2: number[]) => {
    verts.push(a[0], a[1], a[2], b[0], b[1], b[2], c2[0], c2[1], c2[2]);
  };

  for (let s = 0; s < rings.length - 1; s++) {
    const A = rings[s];
    const B = rings[s + 1];
    for (let i = 0; i < A.length; i++) {
      const j = (i + 1) % A.length;
      tri(A[i], A[j], B[j]);
      tri(A[i], B[j], B[i]);
    }
  }

  const cap = (ring: [number, number, number][], forward: boolean) => {
    const cx = ring.reduce((t, p) => t + p[0], 0) / ring.length;
    const cy = ring.reduce((t, p) => t + p[1], 0) / ring.length;
    const centre: [number, number, number] = [cx, cy, ring[0][2]];
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length;
      if (forward) tri(centre, ring[i], ring[j]);
      else tri(centre, ring[j], ring[i]);
    }
  };
  if (capBack) cap(rings[0], false);
  if (capFront) cap(rings[rings.length - 1], true);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.computeVertexNormals();
  return geo;
}

/** A lofted volume added straight to the builder, at the origin. */
function shell(b: PartBuilder, key: MatKey, stations: Station[], capFront = true, capBack = true) {
  b.add(loft(stations, capFront, capBack), key, [0, 0, 0]);
}

// --- bodies -------------------------------------------------------------------

/**
 * The wagon: the long-roof five-door the rest of the game was built around, and
 * the handling baseline every other body is judged against.
 */
function buildWagon(b: PartBuilder) {
  // Hull: tucked at the tail, full through the middle, dropping and narrowing
  // over the front axle into the nose.
  shell(b, 'body', [
    { z: -2.08, hw: 0.80, y0: -0.36, y1: 0.40, c: 0.12 },
    { z: -1.88, hw: 0.90, y0: -0.48, y1: 0.48, c: 0.10 },
    { z: 0.30, hw: 0.92, y0: -0.50, y1: 0.50, c: 0.09 },
    { z: 1.02, hw: 0.91, y0: -0.50, y1: 0.44, c: 0.09 },
    { z: 1.30, hw: 0.90, y0: -0.50, y1: 0.28, c: 0.10 },
    { z: 2.00, hw: 0.87, y0: -0.46, y1: 0.24, c: 0.12 },
    { z: 2.14, hw: 0.76, y0: -0.38, y1: 0.18, c: 0.10 },
  ]);
  // Greenhouse, inset from the waist and pulled in above it. The front station
  // is both lower and further back than the sill, which *is* the windscreen
  // rake — the glass is the loft, not a plate leaned against it.
  shell(b, 'body', [
    { z: -1.98, hw: 0.80, y0: 0.40, y1: 1.22, c: 0.08 },
    { z: -1.70, hw: 0.845, y0: 0.42, y1: 1.30, c: 0.08 },
    { z: 0.62, hw: 0.845, y0: 0.42, y1: 1.30, c: 0.08 },
    { z: 0.96, hw: 0.80, y0: 0.42, y1: 1.22, c: 0.10 },
  ], false, true);
  glassBand(b, [-1.62, 0.56], 0.855, 0.62, 1.14, 2);
  rakedScreen(b, 0.96, 0.42, 1.22, 0.80);
  // Proud of the capped rear face, so it reads as glass set into a panel — and
  // well short of filling it. At near the full width and height of the cabin's
  // back it stopped reading as a window and started reading as the whole tail
  // being made of glass.
  b.add(box(1.26, 0.42, 0.06), 'glass', [0, 0.94, -2.02]);
  b.add(box(1.4, 0.04, 0.05), 'bodyDark', [0, 0.62, -2.03]);

  buildArchesAndSteps(b);
  buildFront(b, 2.14, 1.62);
  buildRearLamps(b, -2.08);
  sideDetails(b, [1.28, 0.14, -1.0], 0.30);
  buildMirrors(b, 0.86, 0.74);
}

/**
 * Full-size American crew cab, in the F-series mould — proportions only, built
 * from primitives here, no badging or licensed geometry (§11).
 *
 * The read is all in the front third: a nose that stands nearly as tall as the
 * roof, almost no bonnet drop, and a grille that fills the face rather than
 * sitting in a letterbox under it.
 */
function buildPickup(b: PartBuilder) {
  const NOSE = 2.22;
  const TAIL = -2.14;
  const WAIST = 0.62;

  // Cab hull and bonnet: one shell, because the whole point is how little the
  // bonnet drops away from the waist.
  shell(b, 'body', [
    { z: -0.40, hw: 0.92, y0: -0.50, y1: WAIST, c: 0.09 },
    { z: 1.06, hw: 0.92, y0: -0.50, y1: WAIST, c: 0.09 },
    { z: 1.34, hw: 0.91, y0: -0.50, y1: 0.56, c: 0.09 },
    { z: 2.06, hw: 0.90, y0: -0.48, y1: 0.52, c: 0.11 },
    { z: NOSE, hw: 0.84, y0: -0.42, y1: 0.46, c: 0.09 },
  ]);
  // Bed. Built as a floor with walls standing on it, not as a solid shell with
  // a darker box sunk into the top — there is no CSG here, so an "inset" block
  // is just more geometry buried inside the volume, invisible from outside. The
  // first version did exactly that and the pickup shipped with a sealed deck
  // where its load bed should be.
  const FLOOR_Y = 0.28;
  const RAIL_Y = WAIST + 0.06;
  shell(b, 'body', [
    { z: TAIL, hw: 0.86, y0: -0.44, y1: FLOOR_Y, c: 0.11 },
    { z: -1.96, hw: 0.92, y0: -0.50, y1: FLOOR_Y, c: 0.09 },
    { z: -0.36, hw: 0.92, y0: -0.50, y1: FLOOR_Y, c: 0.09 },
  ]);
  b.add(box(1.7, 0.05, 1.74), 'bodyDark', [0, FLOOR_Y + 0.02, -1.22]);
  // Walls: sides, bulkhead behind the cab, and the tailgate.
  const wallMid = (FLOOR_Y + RAIL_Y) / 2;
  const wallH = RAIL_Y - FLOOR_Y;
  b.addPair(() => box(0.14, wallH, 1.78), 'body', [0.85, wallMid, -1.24]);
  b.add(box(1.84, wallH, 0.13), 'body', [0, wallMid, -0.42]);
  b.add(box(1.84, wallH + 0.08, 0.12), 'body', [0, wallMid + 0.04, TAIL + 0.07]);
  b.add(box(1.56, 0.1, 0.04), 'bodyDark', [0, wallMid + 0.04, TAIL + 0.02]);
  // Capping rails, and the step up over the rear arch.
  b.addPair(() => box(0.18, 0.05, 1.78), 'trim', [0.85, RAIL_Y, -1.24]);
  b.add(box(1.86, 0.05, 0.15), 'trim', [0, RAIL_Y + 0.08, TAIL + 0.07]);
  b.addPair(() => box(0.19, 0.1, 0.88), 'body', [0.85, RAIL_Y + 0.05, -1.45]);

  // Crew cab: four doors, so the greenhouse runs most of the wheelbase.
  shell(b, 'body', [
    { z: -0.44, hw: 0.82, y0: WAIST, y1: 1.34, c: 0.08 },
    { z: -0.20, hw: 0.855, y0: WAIST, y1: 1.38, c: 0.08 },
    { z: 0.86, hw: 0.855, y0: WAIST, y1: 1.38, c: 0.08 },
    { z: 1.14, hw: 0.80, y0: WAIST, y1: 1.28, c: 0.10 },
  ], false, true);
  glassBand(b, [-0.14, 0.80], 0.865, 0.78, 1.26, 2);
  rakedScreen(b, 1.14, 0.62, 1.28, 0.80);
  b.add(box(1.24, 0.34, 0.06), 'glass', [0, 1.02, -0.48]);

  buildArchesAndSteps(b);

  // The face: one upright slab of grille filling the nose, heavy bar top and
  // bottom, square lamps wrapping the corners.
  b.add(box(1.5, 0.62, 0.08), 'rubber', [0, 0.2, NOSE + 0.01]);
  for (let i = 0; i < 3; i++) {
    b.add(box(1.44, 0.05, 0.05), 'trim', [0, 0.0 + i * 0.2, NOSE + 0.05]);
  }
  b.add(box(1.62, 0.09, 0.1), 'chrome', [0, 0.53, NOSE + 0.02]);
  b.addPair(() => box(0.3, 0.24, 0.06), 'trim', [0.68, 0.26, NOSE + 0.01]);
  b.addPair(() => box(0.24, 0.17, 0.06), 'lamp', [0.68, 0.28, NOSE + 0.04]);
  b.add(box(1.96, 0.3, 0.3), 'chrome', [0, -0.3, NOSE - 0.02]);
  buildRearLamps(b, TAIL);
  sideDetails(b, [1.2, 0.3, -0.42], 0.5);
  buildMirrors(b, 1.06, 0.92);
}

/**
 * The box wagon — a G-Class in proportion and stance, built from primitives,
 * no badging or licensed geometry (§11).
 *
 * Defined by refusing to taper. Every other body here narrows somewhere; this
 * one runs the same width and the same section from bumper to bumper, and the
 * few things that break the box are the recognisable ones: a vertical
 * windscreen, indicator turrets standing on the wing tops, and exposed hinges.
 * The chamfer is kept tight for the same reason — a soft edge would undo it.
 */
function buildGWagon(b: PartBuilder) {
  const NOSE = 1.98;
  const TAIL = -1.90;
  const SIDE = 0.90;
  const WAIST = 0.52;

  shell(b, 'body', [
    { z: TAIL, hw: SIDE, y0: -0.48, y1: WAIST, c: 0.05 },
    { z: 1.16, hw: SIDE, y0: -0.48, y1: WAIST, c: 0.05 },
    { z: 1.22, hw: SIDE, y0: -0.48, y1: 0.42, c: 0.05 },
    { z: NOSE, hw: SIDE, y0: -0.46, y1: 0.42, c: 0.05 },
  ]);
  // Greenhouse: same width as the body, flat sides, flat roof.
  shell(b, 'body', [
    { z: TAIL + 0.04, hw: 0.855, y0: WAIST, y1: 1.42, c: 0.05 },
    { z: 0.82, hw: 0.855, y0: WAIST, y1: 1.42, c: 0.05 },
  ], false, true);
  // Vertical windscreen — no rake at all, which is the whole silhouette. Sized
  // to *close* the open front of the cabin shell rather than to fit inside it.
  b.add(box(1.74, 0.94, 0.06), 'glass', [0, 0.97, 0.83]);
  b.add(box(1.72, 0.08, 0.14), 'trim', [0, 1.36, 0.81]);
  b.add(box(1.72, 0.09, 0.16), 'body', [0, 1.42, 0.84]);
  glassBand(b, [-1.66, 0.72], 0.865, 0.68, 1.3, 2);
  b.add(box(1.3, 0.44, 0.06), 'glass', [0, 1.06, TAIL + 0.02]);
  // Rain gutters: a hard highlight line the length of the roof.
  b.addPair(() => box(0.06, 0.07, 2.6), 'trim', [0.89, 1.35, -0.5]);

  buildArchesAndSteps(b);

  // Round lamps standing proud on the wings, either side of a plain grille.
  b.add(box(1.04, 0.32, 0.07), 'rubber', [0, 0.2, NOSE + 0.01]);
  for (let i = 0; i < 3; i++) {
    b.add(box(0.98, 0.04, 0.05), 'trim', [0, 0.09 + i * 0.11, NOSE + 0.05]);
  }
  b.addPair(() => {
    const g = new THREE.CylinderGeometry(0.16, 0.16, 0.1, 10);
    g.rotateX(Math.PI / 2);
    return g;
  }, 'lamp', [0.62, 0.22, NOSE + 0.04]);
  b.add(box(1.9, 0.24, 0.24), 'trim', [0, -0.26, NOSE - 0.01]);
  // The turrets.
  b.addPair(() => box(0.15, 0.1, 0.24), 'amber', [0.7, 0.47, NOSE - 0.3]);

  buildRearLamps(b, TAIL);
  // Spare on the back door, with its carrier.
  b.add(box(0.1, 0.44, 0.1), 'trim', [0.16, 0.18, TAIL - 0.1]);
  b.add(disc(0.42, 0.2, 14), 'rubber', [0.16, 0.2, TAIL - 0.24]);
  b.add(disc(0.24, 0.22, 12), 'steel', [0.16, 0.2, TAIL - 0.25]);

  // Exposed hinges — two per door, outside the flank.
  for (const z of [0.62, -0.5]) {
    b.addPair(() => box(0.06, 0.09, 0.13), 'trim', [SIDE + 0.02, 0.7, z]);
    b.addPair(() => box(0.06, 0.09, 0.13), 'trim', [SIDE + 0.02, 0.12, z]);
  }
  sideDetails(b, [0.58, -0.48], 0.34);
  buildMirrors(b, 0.8, 0.86);
}

/**
 * The single cab — the working pickup that actually does the driving out here:
 * short cab forward, long steel tray behind, round lamps, snorkel.
 * Seventies-utility proportions, built from primitives, no badging (§11).
 *
 * It shares a silhouette *class* with the crew-cab pickup above, so the whole
 * job is making sure nobody confuses the two at chase-camera distance. Three
 * things do that work, and they are all about where the cab sits:
 *
 * - **One door per side.** The crew cab's greenhouse runs most of the
 *   wheelbase; this one is barely a metre long and stops well short of the rear
 *   axle, which is what leaves room for a tray half again as long.
 * - **The bonnet steps down.** The American truck's headline is a nose standing
 *   nearly as tall as its roof. This is the opposite: a hard 12cm drop off the
 *   cowl to a flat bonnet, so the cab reads as a box sitting on a lower body.
 * - **Round lamps in a body-colour face**, against the other's full-width slab
 *   of grille.
 */
function buildSingleCab(b: PartBuilder) {
  const NOSE = 2.10;
  const TAIL = -2.16;
  const WAIST = 0.56;
  const CAB_BACK = 0.10;
  const CAB_FRONT = 1.18;
  const ROOF = 1.40;

  // Hull and bonnet. The station pair either side of CAB_FRONT is the step:
  // 12cm of drop across 6cm of length, which under flat shading is a hard
  // horizontal highlight right across the front of the car.
  shell(b, 'body', [
    { z: -0.10, hw: 0.90, y0: -0.50, y1: WAIST, c: 0.06 },
    { z: CAB_FRONT, hw: 0.90, y0: -0.50, y1: WAIST, c: 0.06 },
    { z: CAB_FRONT + 0.06, hw: 0.89, y0: -0.50, y1: 0.44, c: 0.06 },
    { z: 1.94, hw: 0.88, y0: -0.48, y1: 0.42, c: 0.07 },
    { z: NOSE, hw: 0.82, y0: -0.44, y1: 0.40, c: 0.06 },
  ]);
  // Bonnet vents, and a flat panel line down the middle of it.
  b.addPair(() => box(0.24, 0.03, 0.12), 'bodyDark', [0.40, 0.45, 1.56]);

  // --- the tray -------------------------------------------------------------
  // Same construction as the crew cab's bed — floor with walls standing on it,
  // never a solid shell with a darker box sunk into it, because there is no CSG
  // here and a buried block is invisible from outside.
  const FLOOR_Y = 0.26;
  const RAIL_Y = WAIST + 0.10;
  shell(b, 'body', [
    { z: TAIL, hw: 0.88, y0: -0.44, y1: FLOOR_Y, c: 0.08 },
    { z: -2.00, hw: 0.90, y0: -0.50, y1: FLOOR_Y, c: 0.07 },
    { z: -0.06, hw: 0.90, y0: -0.50, y1: FLOOR_Y, c: 0.07 },
  ]);
  b.add(box(1.64, 0.05, 1.92), 'bodyDark', [0, FLOOR_Y + 0.02, -1.08]);

  const wallH = RAIL_Y - FLOOR_Y;
  const wallMid = (FLOOR_Y + RAIL_Y) / 2;
  b.addPair(() => box(0.12, wallH, 1.96), 'body', [0.84, wallMid, -1.10]);
  b.add(box(1.78, wallH, 0.11), 'body', [0, wallMid, -0.09]);
  b.add(box(1.78, wallH + 0.06, 0.10), 'body', [0, wallMid + 0.03, TAIL + 0.05]);
  // Vertical ribs down the outside of the tray: pressed-steel utility body, and
  // four hard shadow lines that stop a two-metre flank reading as a blank slab.
  for (const z of [-0.40, -0.90, -1.40, -1.90]) {
    b.addPair(() => box(0.05, wallH, 0.07), 'trim', [0.88, wallMid, z]);
  }
  b.addPair(() => box(0.16, 0.05, 1.96), 'trim', [0.84, RAIL_Y, -1.10]);
  b.add(box(1.82, 0.05, 0.13), 'trim', [0, RAIL_Y + 0.06, TAIL + 0.05]);

  // --- cab ------------------------------------------------------------------
  shell(b, 'body', [
    { z: CAB_BACK, hw: 0.82, y0: WAIST, y1: ROOF - 0.05, c: 0.06 },
    { z: CAB_BACK + 0.16, hw: 0.855, y0: WAIST, y1: ROOF, c: 0.06 },
    { z: 0.90, hw: 0.855, y0: WAIST, y1: ROOF, c: 0.06 },
    { z: CAB_FRONT, hw: 0.80, y0: WAIST, y1: ROOF - 0.09, c: 0.08 },
  ], false, true);
  // One pane per side. Everything else here has two or three.
  glassBand(b, [CAB_BACK + 0.20, 0.86], 0.865, 0.72, ROOF - 0.10, 1);
  rakedScreen(b, CAB_FRONT, 0.66, ROOF - 0.09, 0.80);
  b.add(box(1.14, 0.34, 0.06), 'glass', [0, 1.02, CAB_BACK - 0.02]);

  buildArchesAndSteps(b);

  // --- face -----------------------------------------------------------------
  // Body colour carried across the nose with the grille as a modest slot in the
  // middle of it, round lamps in chrome bezels outboard. The crew cab's face is
  // one full-width slab; this one is a painted panel with holes in it.
  b.add(box(1.62, 0.34, 0.05), 'body', [0, 0.24, NOSE]);
  b.add(box(0.84, 0.24, 0.07), 'rubber', [0, 0.22, NOSE + 0.02]);
  for (let i = 0; i < 4; i++) {
    b.add(box(0.78, 0.03, 0.04), 'trim', [0, 0.13 + i * 0.06, NOSE + 0.05]);
  }
  const round = (r: number, d: number) => () => {
    const g = new THREE.CylinderGeometry(r, r, d, 12);
    g.rotateX(Math.PI / 2);
    return g;
  };
  b.addPair(round(0.185, 0.05), 'chrome', [0.60, 0.24, NOSE + 0.02]);
  b.addPair(round(0.15, 0.07), 'lamp', [0.60, 0.24, NOSE + 0.05]);
  b.addPair(() => box(0.15, 0.09, 0.05), 'amber', [0.60, 0.02, NOSE + 0.03]);
  // Plain steel bar on stays, sitting off the body — not a moulded bumper.
  b.add(box(1.76, 0.15, 0.15), 'steel', [0, -0.28, NOSE + 0.04]);
  b.addPair(() => box(0.08, 0.2, 0.1), 'steel', [0.60, -0.19, NOSE - 0.02]);

  // Snorkel up the right A-pillar. One part, and it does more for "this thing
  // actually goes out there" than any amount of bodywork.
  b.strut('trim', [0.87, 0.40, 1.34], [0.87, 1.24, 1.20], 0.055);
  b.add(box(0.13, 0.22, 0.15), 'trim', [0.87, 1.34, 1.19]);

  buildRearLamps(b, TAIL);
  sideDetails(b, [1.14, 0.08], 0.34);
  buildMirrors(b, 1.10, 0.86);
}

/**
 * The soft top — roof off, doors off, cage up.
 *
 * The one thing none of the other closed bodies can do is let you see *through*
 * the vehicle, and that is the whole brief here. A gap of sky between the sill
 * and the cage, with two seats and a steering wheel visible inside it, is a
 * silhouette nothing else in the picker comes near — far more distinguishing at
 * chase distance than any amount of panel detail would be.
 *
 * Which means the interior is load-bearing for the first time. Every other body
 * hides its cabin behind glass and can leave it empty; strip the sides off and
 * an empty tub reads as an unfinished model. Hence seats, headrests, a wheel on
 * a column, and a rolled canvas stowed behind the rear bench.
 *
 * Built the same way as the pickup bed — floor plate with walls standing on it,
 * never a solid loft with a hollow implied inside it, because there is no CSG
 * here and an "inset" volume is just geometry buried where nobody can see it.
 * The sill deliberately steps down 18cm through the door aperture: that drop is
 * what says the doors are *off* rather than that the body was moulded without
 * them, and it is also why this is the one body that skips `sideDetails` — no
 * doors, no door seams.
 */
function buildSoftTop(b: PartBuilder) {
  const NOSE = 2.02;
  const TAIL = -2.00;
  /** Tub floor, and the top of the tub sides. */
  const FLOOR_Y = 0.14;
  const SILL_Y = 0.66;
  const SCREEN_TOP = 1.34;
  const SCREEN_Z = 0.88;
  const HOOP_Y = 1.42;
  const HOOP_Z = -0.60;

  // Lower body, closed, from the tail to the bulkhead.
  shell(b, 'body', [
    { z: TAIL, hw: 0.86, y0: -0.46, y1: FLOOR_Y, c: 0.10 },
    { z: -1.80, hw: 0.90, y0: -0.50, y1: FLOOR_Y, c: 0.08 },
    { z: 1.02, hw: 0.90, y0: -0.50, y1: FLOOR_Y, c: 0.08 },
  ]);
  // Bonnet, forward of the scuttle. Flat and low — this is a short vehicle
  // whose bonnet is the least of it.
  shell(b, 'body', [
    { z: 1.02, hw: 0.90, y0: -0.50, y1: 0.52, c: 0.08 },
    { z: 1.84, hw: 0.88, y0: -0.48, y1: 0.50, c: 0.09 },
    { z: NOSE, hw: 0.80, y0: -0.44, y1: 0.46, c: 0.07 },
  ]);
  b.add(box(1.66, 0.05, 2.86), 'bodyDark', [0, FLOOR_Y + 0.02, -0.42]);

  // --- tub walls ------------------------------------------------------------
  const wallH = SILL_Y - FLOOR_Y;
  const wallMid = (FLOOR_Y + SILL_Y) / 2;
  // Rear quarter: full height, behind where a B-pillar would be.
  b.addPair(() => box(0.11, wallH, 1.32), 'body', [0.85, wallMid, -1.28]);
  // Door aperture: the same wall, 18cm lower. The step is the read.
  const doorH = wallH - 0.18;
  b.addPair(() => box(0.11, doorH, 1.56), 'body', [0.85, FLOOR_Y + doorH / 2, 0.22]);
  b.add(box(1.78, wallH, 0.11), 'body', [0, wallMid, TAIL + 0.06]);
  // Scuttle top, closing the tub against the bonnet.
  b.add(box(1.78, 0.10, 0.28), 'bodyDark', [0, SILL_Y - 0.02, 0.90]);

  // --- screen and cage ------------------------------------------------------
  b.strutPair('trim', [0.80, SILL_Y, 1.00], [0.76, SCREEN_TOP, SCREEN_Z], 0.05);
  b.add(tube(1.54, 0.05), 'trim', [0, SCREEN_TOP, SCREEN_Z], [0, 0, Math.PI / 2]);
  b.add(
    box(1.5, SCREEN_TOP - SILL_Y - 0.02, 0.05), 'glass',
    [0, (SILL_Y + SCREEN_TOP) / 2, SCREEN_Z + 0.05], [-0.14, 0, 0],
  );
  // Main hoop, its header, the rails forward to the screen and the rear stays.
  b.strutPair('trim', [0.80, SILL_Y - 0.06, HOOP_Z], [0.74, HOOP_Y, HOOP_Z], 0.055);
  b.add(tube(1.5, 0.055), 'trim', [0, HOOP_Y, HOOP_Z], [0, 0, Math.PI / 2]);
  b.strutPair('trim', [0.74, HOOP_Y, HOOP_Z], [0.76, SCREEN_TOP, SCREEN_Z], 0.048);
  b.strutPair('trim', [0.74, HOOP_Y, HOOP_Z], [0.80, SILL_Y - 0.02, TAIL + 0.22], 0.045);
  // The diagonal brace across the hoop — every cage has one, and it is the
  // detail that stops the hoop reading as a decorative arch.
  b.strut('trim', [-0.72, HOOP_Y - 0.05, HOOP_Z], [0.74, SILL_Y + 0.04, HOOP_Z], 0.04);

  // --- interior, visible for the first time ---------------------------------
  // Stacked off the floor plate rather than off FLOOR_Y: the plate is 5cm thick
  // and sits 2cm proud, so seats placed against the nominal floor hover a
  // visible 9cm above the one they are supposed to be bolted to. Each piece
  // below starts where the one under it ends.
  const PLATE_TOP = FLOOR_Y + 0.045;
  for (const z of [0.30, -1.02]) {
    b.addPair(() => box(0.48, 0.12, 0.48), 'rubber', [0.42, PLATE_TOP + 0.06, z]);
    b.addPair(() => box(0.48, 0.56, 0.12), 'rubber', [0.42, PLATE_TOP + 0.40, z - 0.26]);
    b.addPair(() => box(0.32, 0.17, 0.11), 'rubber', [0.42, PLATE_TOP + 0.75, z - 0.26]);
  }
  // Left-hand drive: +X is the left side with +Z forward, and the UAE drives on
  // the right. Column first and stated as a strut between two joints, wheel on
  // the end of it — a wheel floating in front of a seat with nothing behind it
  // is the same tell the buggy shipped with once already.
  b.strut('trim', [0.42, 0.60, 0.96], [0.42, 0.70, 0.64], 0.028);
  b.add(disc(0.17, 0.04, 10), 'trim', [0.42, 0.70, 0.62], [0.6, 0, 0]);
  // The roof, rolled up and strapped behind the rear seats where it lives.
  b.add(tube(1.44, 0.13), 'cargo', [0, SILL_Y + 0.08, TAIL + 0.46], [0, 0, Math.PI / 2]);
  b.addPair(() => box(0.05, 0.3, 0.05), 'trim', [0.5, SILL_Y + 0.02, TAIL + 0.46]);

  buildArchesAndSteps(b);

  // --- face -----------------------------------------------------------------
  // Vertical slots and round lamps: the open-top idiom, and nothing like the
  // horizontal-slat faces on the two pickups.
  b.add(box(1.14, 0.32, 0.06), 'rubber', [0, 0.24, NOSE + 0.01]);
  for (let i = 0; i < 7; i++) {
    b.add(box(0.06, 0.26, 0.05), 'trim', [-0.45 + i * 0.15, 0.24, NOSE + 0.04]);
  }
  const round = (r: number, d: number) => () => {
    const g = new THREE.CylinderGeometry(r, r, d, 12);
    g.rotateX(Math.PI / 2);
    return g;
  };
  b.addPair(round(0.175, 0.05), 'trim', [0.68, 0.26, NOSE + 0.02]);
  b.addPair(round(0.142, 0.07), 'lamp', [0.68, 0.26, NOSE + 0.05]);
  b.addPair(() => box(0.13, 0.09, 0.05), 'amber', [0.68, 0.02, NOSE + 0.03]);
  b.add(box(1.7, 0.15, 0.15), 'steel', [0, -0.3, NOSE + 0.03]);

  buildRearLamps(b, TAIL);
  // Spare on the tailgate, offset to one side like every one of these.
  b.add(box(0.1, 0.46, 0.1), 'trim', [0.14, 0.24, TAIL - 0.06]);
  b.add(disc(0.42, 0.2, 14), 'rubber', [0.14, 0.28, TAIL - 0.2]);
  b.add(disc(0.24, 0.22, 12), 'steel', [0.14, 0.28, TAIL - 0.21]);

  b.addPair(() => box(0.14, 0.03, 0.03), 'trim', [0.95, 0.86, 1.02]);
  b.addPair(() => box(0.06, 0.16, 0.11), 'trim', [1.03, 0.86, 1.02]);
}

/**
 * The bike — a desert sled, stretched.
 *
 * ## The proportion problem, stated plainly
 *
 * Every body shares one footprint, and its wheelbase is 2.9m. A real dirt bike
 * is about 1.5m. So this is drawn at nearly twice the wheelbase of the thing it
 * is named after, which is exactly the reason the quad was abandoned rather
 * than built — a quad at this size is a monster truck and there is no reading
 * of it that isn't wrong.
 *
 * A bike survives the stretch where a quad didn't, because long-wheelbase bikes
 * are a real thing people build: desert sleds, drag bikes, anything set up to
 * stay planted at speed rather than turn quickly. Leaning into it — long, low,
 * a stretched swingarm, a tank well forward of the seat — turns the constraint
 * into the design instead of fighting it. It is still a compromise and the
 * silhouette is the place it shows.
 *
 * ## What makes it read as a bike rather than a thin car
 *
 * Two things, and neither is bodywork. **Two wheels on the centreline** (see
 * BodySpec.twoWheeled) and **lean** — a bike that stays bolt upright through a
 * corner reads as broken no matter how good the model is, and one that lays
 * over reads as a bike even in silhouette. Everything below is detail hung on
 * those two.
 *
 * No rider, deliberately: the soft top has empty seats and the closed bodies
 * have empty cabins, so a lone modelled human on this one would be the odd
 * thing out rather than the missing thing found.
 */
function buildMoto(b: PartBuilder) {
  const FRONT_Z = HALF_WHEELBASE;
  const REAR_Z = -HALF_WHEELBASE;
  /** Static hub height, the same one the arches are drawn against. */
  const HUB_Y = AXLE_HEIGHT - 0.4;
  /** Steering head: where the forks meet the frame. */
  const HEAD: [number, number, number] = [0, 0.42, 1.18];
  const PIVOT: [number, number, number] = [0, -0.34, -0.28];

  // --- frame ----------------------------------------------------------------
  // Stated as struts between named joints, the rule the buggy's cage had to
  // learn the hard way: a tube placed by centre-plus-angle drifts out of step
  // with the things it is supposed to connect and ends up in mid-air.
  b.strut('trim', HEAD, [0, 0.06, 0.1], 0.055);          // top tube
  b.strut('trim', HEAD, [0, -0.3, 0.62], 0.05);          // down tube
  b.strut('trim', [0, 0.06, 0.1], PIVOT, 0.05);          // seat tube
  b.strut('trim', [0, -0.3, 0.62], PIVOT, 0.045);        // cradle

  // Forks, as a pair either side of the wheel, raked back about 14 degrees.
  b.strutPair('steel', [0.12, 0.5, 1.1], [0.12, HUB_Y, FRONT_Z], 0.045);
  b.add(box(0.3, 0.16, 0.2), 'trim', [0, 0.5, 1.14]);    // triple clamp
  // Swingarm out to the rear hub. Long, which is the whole conceit.
  b.strutPair('steel', [0.1, -0.34, -0.28], [0.1, HUB_Y, REAR_Z], 0.05);
  // Rear shock, laid down along the swingarm the way a long one has to be.
  b.strut('amber', [0, 0.04, -0.2], [0, HUB_Y + 0.12, -1.0], 0.055);

  // --- engine, tank, seat ---------------------------------------------------
  b.add(box(0.4, 0.46, 0.62), 'bodyDark', [0, -0.22, 0.24]);
  b.add(box(0.3, 0.3, 0.34), 'trim', [0, 0.02, 0.12]);   // barrel and head
  // Tank: the widest painted thing on it, and most of what carries the colour.
  shell(b, 'body', [
    { z: 0.18, hw: 0.15, y0: 0.06, y1: 0.4, c: 0.05 },
    { z: 0.46, hw: 0.22, y0: 0.04, y1: 0.46, c: 0.07 },
    { z: 0.86, hw: 0.2, y0: 0.06, y1: 0.42, c: 0.07 },
    { z: 1.06, hw: 0.12, y0: 0.12, y1: 0.34, c: 0.05 },
  ]);
  // Seat, long and flat — a stretched frame gives you nowhere else to put it.
  b.add(box(0.28, 0.12, 0.92), 'rubber', [0, 0.3, -0.42]);
  b.add(box(0.24, 0.1, 0.32), 'body', [0, 0.38, -0.94]);
  // Subframe under it, so the seat is held up by something.
  b.strutPair('trim', [0.1, 0.08, -0.1], [0.1, 0.26, -0.92], 0.035);
  b.addPair(() => box(0.05, 0.16, 0.3), 'trim', [0.15, 0.4, -1.0]);

  // --- bars, lamp, plate ----------------------------------------------------
  b.add(tube(0.76, 0.035), 'steel', [0, 0.74, 1.1], [0, 0, Math.PI / 2]);
  b.addPair(() => box(0.11, 0.05, 0.05), 'rubber', [0.33, 0.74, 1.1]);
  b.strut('steel', [0, 0.5, 1.14], [0, 0.74, 1.1], 0.035);
  b.add(box(0.26, 0.24, 0.1), 'trim', [0, 0.58, 1.28]);
  b.add(box(0.2, 0.18, 0.06), 'lamp', [0, 0.58, 1.34]);
  b.add(box(0.3, 0.26, 0.04), 'body', [0, 0.24, 1.3]);   // number plate

  // --- fenders --------------------------------------------------------------
  // High and short at the front, the way anything meant for sand is set up:
  // a close-fitting fender packs solid within a minute of real use.
  b.add(box(0.3, 0.06, 0.62), 'body', [0, 0.12, 1.42], [-0.16, 0, 0]);
  b.add(box(0.34, 0.06, 0.66), 'body', [0, -0.06, -1.32], [0.12, 0, 0]);
  b.add(box(0.13, 0.1, 0.12), 'brake', [0, 0.16, -1.46]);

  // Exhaust, up and over the swingarm on one side so it clears the tyre.
  b.strut('chrome', [0.16, -0.24, 0.3], [0.2, 0.06, -1.02], 0.055);
  b.add(box(0.13, 0.13, 0.34), 'trim', [0.2, 0.08, -1.16]);
}

/**
 * Sand rail — a dragster built for dunes: long, low, rear-engined, and mostly
 * air.
 *
 * ## Wheels have to be *attached*
 *
 * This is the thing the previous version got wrong, and it read as broken on a
 * real screen. Every closed body here hides its hubs behind arch flares, so
 * nothing ever had to explain how the wheel joins the truck. Strip the
 * bodywork away and that explanation is suddenly load-bearing: with no arches
 * and no suspension, four wheels hovered a foot off a narrow frame, connected
 * to nothing, and the eye reads that as parts that have fallen off rather than
 * as a vehicle. So each corner now carries a lower arm, a trailing link and a
 * coil-over running up to the frame.
 *
 * They are static, mounted to the body rather than to the moving wheel, and
 * that is a deliberate trade: a static arm drifts by a few centimetres at full
 * articulation, which nobody notices, while an arm parented to the wheel would
 * swing with steering lock and look far worse. The links are kept short and
 * close to the hub so there is no long lever to visibly detach.
 *
 * ## Reading as a dragster
 *
 * Long and low, weight over the back axle, and three cues doing most of the
 * work: **zoomie headers** standing straight up out of the engine, a **wing**
 * on struts over the tail, and a frame that runs unbroken from a pointed nose
 * to well past the rear wheels. Everything sits below the hoop line except
 * those three, so the silhouette is a low horizontal bar with a tall hoop and
 * a wing at one end — which is a dragster from any angle.
 */
function buildBuggy(b: PartBuilder) {
  const NOSE = 2.0;
  const TAIL = -2.0;
  const T = 0.05;
  /** Frame rails, inboard of the wheels with the suspension bridging the gap. */
  const RAIL = 0.6;
  const RAIL_Y = -0.3;
  /**
   * Static wheel-centre height. Measured off the settled vehicle rather than
   * guessed — at rest the buggy's wheels sit at -0.628, and the suspension
   * geometry below is drawn to meet them there.
   */
  const HUB_Y = AXLE_HEIGHT - 0.38;
  /** Top of the shock tower: where every coil-over lands. */
  const TOWER_X = 0.5;
  const TOWER_Y = 0.34;
  const HOOP_Y = 1.04;
  const HOOP_Z = -0.42;
  const SCUTTLE_Z = 0.82;
  const SCUTTLE_Y = 0.56;
  /**
   * The rear stays, hoisted up here because three other things hang off them.
   * Anything that wants to attach at the back of the car attaches to a point on
   * this line rather than to a guessed height.
   */
  const stayTop: [number, number, number] = [RAIL, HOOP_Y, HOOP_Z];
  const stayFoot: [number, number, number] = [RAIL, RAIL_Y + 0.06, TAIL + 0.14];

  /** A point a fraction of the way along a line, for hanging things off it. */
  const lerp3 = (
    a: [number, number, number],
    b2: [number, number, number],
    t: number,
  ): [number, number, number] => [
    a[0] + (b2[0] - a[0]) * t,
    a[1] + (b2[1] - a[1]) * t,
    a[2] + (b2[2] - a[2]) * t,
  ];

  // --- frame ----------------------------------------------------------------
  // Two rails the full length of the car. These are the silhouette's baseline,
  // so they run nose to tail unbroken.
  b.addPair(() => tube(NOSE - TAIL, 0.075), 'trim', [RAIL, -0.3, (NOSE + TAIL) / 2], [Math.PI / 2, 0, 0]);
  // Upper rails at waist height, tying the cockpit together. Run scuttle-upright
  // to rear-stay rather than as a fixed 2.1m length: the fixed one stopped at
  // z=-1.2 with the nearest structure 78cm further back, so its rear end hung
  // over the engine bay attached to nothing.
  b.strutPair('trim', [RAIL, 0.16, SCUTTLE_Z], lerp3(stayTop, stayFoot, 0.6875), 0.05);
  for (const z of [1.32, 0.5, -0.6, -1.5]) {
    b.add(tube(RAIL * 2, 0.055), 'trim', [0, -0.3, z], [0, 0, Math.PI / 2]);
  }

  // Floor pan and low side pods, in body colour so the paint choice registers
  // on a vehicle that is otherwise almost entirely black tube.
  b.add(box(RAIL * 2 - 0.06, 0.05, 2.2), 'bodyDark', [0, -0.27, -0.1]);
  b.addPair(() => box(0.07, 0.3, 1.9), 'body', [RAIL - 0.02, -0.1, -0.15]);

  // Pointed nose: the one place with real bodywork.
  shell(b, 'body', [
    { z: 0.72, hw: 0.56, y0: -0.3, y1: 0.06, c: 0.07 },
    { z: 1.42, hw: 0.5, y0: -0.3, y1: 0.0, c: 0.07 },
    { z: 1.86, hw: 0.28, y0: -0.28, y1: -0.08, c: 0.06 },
  ]);
  b.add(box(0.9, 0.04, 0.7), 'bodyDark', [0, -0.33, 1.3]);

  // --- suspension, one corner at a time -------------------------------------
  //
  // Every member here is stated as the two joints it connects, the same rule
  // the cage already follows, because the version that placed each tube by
  // centre-plus-length-plus-rotation had three of them ending in mid-air: the
  // coil-overs reached up to a top rail that doesn't extend past the cockpit,
  // and the trailing links stopped 18cm outboard of the frame. A strut between
  // two named points cannot float — if a point is wrong the whole member is
  // visibly wrong, rather than one end of it quietly hanging.
  for (const z of [HALF_WHEELBASE, -HALF_WHEELBASE]) {
    const front = z > 0;
    const hub: [number, number, number] = [HALF_TRACK, HUB_Y, z];
    const towerTop: [number, number, number] = [TOWER_X, TOWER_Y, z];

    // Shock tower: up off the main rail, triangulated fore-aft against it. This
    // is the part that was missing — without somewhere for the coil to land,
    // the coil is just a pipe standing next to a wheel.
    b.strutPair('trim', [RAIL, RAIL_Y, z], towerTop, 0.045);
    b.strutPair('trim', towerTop, [RAIL, RAIL_Y, z + (front ? -0.62 : 0.62)], 0.035);

    // Lower arm, from under the rail out to the hub. The inboard end sits
    // inside the rail tube (0.075 radius), not next to it — the first pass was
    // 11mm clear of it, which at this scale is a visible gap.
    b.strutPair('steel', [RAIL - 0.04, RAIL_Y - 0.04, z], hub, 0.045);
    // Trailing link back to the frame, so the wheel is located fore-aft as well
    // as laterally — one arm alone still reads as a wheel on a stick.
    b.strutPair(
      'steel',
      [HALF_TRACK - 0.03, HUB_Y + 0.06, z],
      [RAIL, RAIL_Y - 0.03, z + (front ? -0.82 : 0.82)],
      0.038,
    );

    // Coil-over: hub to tower top, with the spring drawn as a fatter section
    // over the middle third of the same line so it can't drift off it.
    const coilLow: [number, number, number] = [HALF_TRACK - 0.06, HUB_Y + 0.05, z];
    b.strutPair('steel', coilLow, towerTop, 0.05);
    b.strutPair('amber', lerp3(coilLow, towerTop, 0.22), lerp3(coilLow, towerTop, 0.68), 0.082);

    // Hub carrier, so the arms land on something with a face.
    b.addPair(() => box(0.09, 0.22, 0.16), 'steel', [HALF_TRACK, HUB_Y, z]);
  }

  // --- cockpit --------------------------------------------------------------
  b.addPair(() => box(0.38, 0.1, 0.42), 'cargo', [0.3, -0.2, 0.06]);
  b.addPair(() => box(0.38, 0.52, 0.1), 'cargo', [0.3, 0.08, -0.2]);
  b.addPair(() => box(0.26, 0.14, 0.09), 'trim', [0.3, 0.38, -0.2]);
  b.addPair(() => box(0.05, 0.44, 0.03), 'amber', [0.22, 0.1, -0.14], [0, 0, 0.14]);
  // Dash spans the full width so it lands on the scuttle uprights at ±RAIL,
  // rather than hanging between them.
  b.add(box(RAIL * 2 - 0.02, 0.17, 0.22), 'bodyDark', [0, 0.1, 0.78]);
  // Column first, wheel on the end of it. A steering wheel floating in front of
  // a seat with nothing behind it was one of the tells.
  b.strut('trim', [0.3, 0.13, 0.7], [0.3, 0.26, 0.5], 0.024);
  b.add(disc(0.16, 0.04, 10), 'trim', [0.3, 0.27, 0.48], [0.55, 0, 0]);

  // --- engine and zoomies ---------------------------------------------------
  // Sat behind the rear axle where a rail carries it, and left bare. Dark
  // rather than bare steel: at 0.4 half-width in a pale grey it read as a
  // chest freezer strapped to the back, and an engine block is a dark object.
  shell(b, 'bodyDark', [
    { z: -1.9, hw: 0.3, y0: -0.2, y1: 0.16, c: 0.06 },
    { z: -1.66, hw: 0.35, y0: -0.24, y1: 0.22, c: 0.06 },
    { z: -1.26, hw: 0.35, y0: -0.24, y1: 0.22, c: 0.06 },
  ]);
  b.add(box(0.66, 0.08, 0.58), 'trim', [0, 0.24, -1.58]);
  // Zoomie headers: four short stacks straight up out of the block. The single
  // clearest dragster cue available, and they cost four boxes.
  for (const side of [1, -1]) {
    for (let i = 0; i < 2; i++) {
      const zz = -1.36 - i * 0.3;
      b.add(tube(0.46, 0.042), 'chrome', [side * 0.3, 0.46, zz], [-0.34, 0, 0]);
    }
  }

  // --- cage -----------------------------------------------------------------
  // Every member is stated as the two joints it connects, so the structure is
  // closed by construction — no bar can point somewhere its ends don't.
  //
  // Main hoop: uprights and crossbar.
  b.strutPair('trim', [RAIL, RAIL_Y, HOOP_Z], [RAIL, HOOP_Y, HOOP_Z], T);
  b.strut('trim', [-RAIL, HOOP_Y, HOOP_Z], [RAIL, HOOP_Y, HOOP_Z], T);
  // Diagonal across it, corner to corner.
  b.strut('trim', [RAIL, RAIL_Y, HOOP_Z], [-RAIL, HOOP_Y, HOOP_Z], 0.036);

  // Front hoop over the scuttle, and the roof rails tying the two together.
  b.strutPair('trim', [RAIL, RAIL_Y, SCUTTLE_Z], [RAIL, SCUTTLE_Y, SCUTTLE_Z], T);
  b.strut('trim', [-RAIL, SCUTTLE_Y, SCUTTLE_Z], [RAIL, SCUTTLE_Y, SCUTTLE_Z], T);
  b.strutPair('trim', [RAIL, HOOP_Y, HOOP_Z], [RAIL, SCUTTLE_Y, SCUTTLE_Z], T);

  // Rear stays from the top of the hoop down to the tail of the frame, over the
  // engine. These are what stop the hoop reading as a standalone arch.
  b.strutPair('trim', stayTop, stayFoot, T);

  // --- wing -----------------------------------------------------------------
  // Small, high and flat over the tail: reads at any distance, and it is the
  // second half of the dragster silhouette after the zoomies.
  //
  // The struts hang off a point *on* the rear stays rather than off a hard-coded
  // height, which is what they used to do — the old base sat at y=0.5 over an
  // engine whose deck is at 0.28, so the whole wing floated above the car.
  const WING_Y = 1.12;
  const WING_Z = -1.82;
  const wingFoot = lerp3(stayTop, stayFoot, 0.72);
  b.strutPair('trim', wingFoot, [RAIL - 0.1, WING_Y - 0.04, WING_Z], 0.032);
  b.add(box(1.4, 0.05, 0.36), 'body', [0, WING_Y, WING_Z], [0.2, 0, 0]);
  b.addPair(() => box(0.04, 0.16, 0.32), 'body', [0.68, WING_Y + 0.06, WING_Z]);

  // --- lights and bumpers ---------------------------------------------------
  // Lamps sit down in the nose deck rather than hovering over it — the deck
  // runs from y=0.06 at the scuttle end to flat by the tip, so a lamp centred
  // on zero is half-recessed the whole way along.
  b.addPair(() => {
    const g = new THREE.CylinderGeometry(0.1, 0.1, 0.1, 10);
    g.rotateX(Math.PI / 2);
    return g;
  }, 'lamp', [0.26, 0.0, 1.12]);
  b.add(tube(1.16, 0.045), 'steel', [0, -0.26, NOSE - 0.06], [0, 0, Math.PI / 2]);
  b.add(tube(1.2, 0.045), 'steel', [0, -0.22, TAIL + 0.04], [0, 0, Math.PI / 2]);
  // On the rear bar, not above it.
  for (const side of [1, -1]) {
    b.add(box(0.14, 0.1, 0.06), 'brake', [side * 0.42, -0.19, TAIL + 0.02]);
  }
  // Whip and flag, required kit out there and a useful vertical accent. Rooted
  // on the tail of the frame; it used to start two-thirds of the way up in
  // clear air.
  b.strut('trim', [-RAIL, RAIL_Y, TAIL + 0.12], [-RAIL - 0.04, 1.18, TAIL + 0.06], 0.017);
  b.add(box(0.2, 0.13, 0.02), 'amber', [-RAIL - 0.06, 1.26, TAIL + 0.06]);
}

// --- shared body details ------------------------------------------------------

/** Side glass as a run of panes, split by pillars. */
function glassBand(
  b: PartBuilder,
  span: [number, number],
  x: number,
  y0: number,
  y1: number,
  panes: number,
) {
  const [back, front] = span;
  const total = front - back;
  const gap = 0.07;
  const each = (total - gap * (panes - 1)) / panes;
  for (let i = 0; i < panes; i++) {
    const z = back + each / 2 + i * (each + gap);
    b.addPair(() => box(0.05, y1 - y0, each), 'glass', [x, (y0 + y1) / 2, z]);
    if (i > 0) {
      b.addPair(() => box(0.06, y1 - y0, gap), 'body', [x - 0.005, (y0 + y1) / 2, z - each / 2 - gap / 2]);
    }
  }
}

/**
 * A raked windscreen with its pillars, closing the front of a cabin shell.
 *
 * Deliberately oversized against the opening it covers. The cabin lofts are
 * capped at the back but left open at the front, because a vertical cap can't
 * sit behind a raked pane without one poking through the other — so this pane
 * *is* the front of the cabin, and it has to overlap the hole rather than fit
 * it. Sized to fit, it leaves a slot around the edges that you can see the
 * far side of the interior through, which is exactly how the first version
 * shipped.
 */
function rakedScreen(b: PartBuilder, z: number, y0: number, y1: number, halfW: number) {
  const h = y1 - y0;
  const midY = (y0 + y1) / 2;
  b.add(box(halfW * 2 + 0.06, h + 0.14, 0.06), 'glass', [0, midY, z - 0.02], [-0.24, 0, 0]);
  b.addPair(() => box(0.09, h + 0.14, 0.08), 'body', [halfW + 0.01, midY, z - 0.02], [-0.24, 0, 0]);
  b.add(box(halfW * 2 + 0.14, 0.1, 0.12), 'trim', [0, y1 + 0.05, z - 0.13]);
}

/** Door seams and handles down the flank, at the given z stations. */
function sideDetails(b: PartBuilder, seams: number[], handleY: number) {
  for (const z of seams) {
    b.addPair(() => box(0.02, 0.9, 0.03), 'bodyDark', [BODY_HALF_W, 0.02, z]);
  }
  for (let i = 0; i < seams.length - 1; i++) {
    const mid = (seams[i] + seams[i + 1]) / 2;
    b.addPair(() => box(0.04, 0.06, 0.22), 'trim', [BODY_HALF_W + 0.01, handleY, mid]);
  }
}

/**
 * Whether a body runs on two wheels.
 *
 * Exported because the mesh is not the only thing that needs to know. The
 * physics runs four raycasts for every body (see BACKLOG item 12), so anything
 * downstream that reads wheel contacts — the tyre tracks, most obviously — will
 * happily produce a four-wheeler's output for a bike unless it asks.
 */
export function isTwoWheeled(body: BodyId): boolean {
  return BODIES[body]?.twoWheeled === true;
}

const BODIES: Record<BodyId, BodySpec> = {
  wagon: { build: buildWagon },
  pickup: { build: buildPickup },
  gwagon: { build: buildGWagon },
  singlecab: { build: buildSingleCab },
  softtop: { build: buildSoftTop },
  moto: { build: buildMoto, twoWheeled: true, wheelWidth: 0.42 },
  buggy: { build: buildBuggy },
};

function buildWheelGeometry(
  style: WheelStyleId,
): { tyre: THREE.BufferGeometry; rim: THREE.BufferGeometry } {
  const tyreParts: THREE.BufferGeometry[] = [];
  const rimParts: THREE.BufferGeometry[] = [];

  const tread = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, WHEEL_WIDTH, 14);
  tread.rotateZ(Math.PI / 2);
  tyreParts.push(tread);

  const along = (radius: number, width: number, segments: number) => {
    const g = new THREE.CylinderGeometry(radius, radius, width, segments);
    g.rotateZ(Math.PI / 2);
    return g;
  };
  const holes = (count: number, radius: number, ring: number, width: number) => {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const hole = along(radius, width, 6);
      hole.translate(0, Math.cos(a) * ring, Math.sin(a) * ring);
      tyreParts.push(hole);
    }
  };

  if (style === 'steel') {
    // Dish proud of the tread on both faces so it reads from either side.
    rimParts.push(along(0.245, WHEEL_WIDTH + 0.04, 12));
    rimParts.push(along(0.085, WHEEL_WIDTH + 0.08, 8));
    holes(6, 0.048, 0.155, WHEEL_WIDTH + 0.07);
  } else if (style === 'alloy') {
    // Wider face with five big openings: the same trick as the steel, scaled up
    // until the metal between the holes reads as spokes rather than as a dish.
    rimParts.push(along(0.3, WHEEL_WIDTH + 0.04, 12));
    rimParts.push(along(0.11, WHEEL_WIDTH + 0.1, 8));
    holes(5, 0.088, 0.185, WHEEL_WIDTH + 0.07);
  } else {
    // Beadlock: a dark clamping ring around a smaller dish, bolts around it.
    tyreParts.push(along(0.325, WHEEL_WIDTH + 0.02, 14));
    rimParts.push(along(0.255, WHEEL_WIDTH + 0.06, 12));
    rimParts.push(along(0.095, WHEEL_WIDTH + 0.1, 8));
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const bolt = along(0.026, WHEEL_WIDTH + 0.07, 5);
      bolt.translate(0, Math.cos(a) * 0.292, Math.sin(a) * 0.292);
      rimParts.push(bolt);
    }
    holes(5, 0.062, 0.15, WHEEL_WIDTH + 0.09);
  }

  const tyre = mergeGeometries(tyreParts, false) ?? tread;
  const rim = mergeGeometries(rimParts, false) ?? along(0.245, WHEEL_WIDTH, 12);
  for (const g of [...tyreParts, ...rimParts]) {
    if (g !== tyre && g !== rim) g.dispose();
  }
  tyre.computeBoundingSphere();
  rim.computeBoundingSphere();
  return { tyre, rim };
}
