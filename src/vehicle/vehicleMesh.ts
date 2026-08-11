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
  update(wheels: WheelState[]): void;
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

/**
 * A body is now just its builder. The bolt-on accessories this used to carry
 * mounting points for are gone: five toggles multiplying four bodies meant
 * every silhouette had to survive 32 combinations, which pushed each one toward
 * a shape generic enough to hang anything off. Fewer, more committed vehicles
 * beat more permutations of a vague one.
 */
interface BodySpec {
  build(b: PartBuilder): void;
}

export function createVehicleView(config: VehicleConfig = DEFAULT_VEHICLE): VehicleView {
  const root = new THREE.Group();
  const materials = createMaterials(paintColor(config.paint));
  const b = new PartBuilder(materials);
  const spec = BODIES[config.body];

  spec.build(b);

  const bodyMeshes = b.build();
  for (const mesh of bodyMeshes) root.add(mesh);

  // --- wheels ---------------------------------------------------------------
  const wheelGeos = buildWheelGeometry(config.wheels);

  const wheels: THREE.Group[] = [];
  for (let i = 0; i < 4; i++) {
    // Outer group carries steering + suspension position, inner carries spin.
    const steerGroup = new THREE.Group();
    const spinGroup = new THREE.Group();

    const tyre = new THREE.Mesh(wheelGeos.tyre, materials.rubber);
    tyre.castShadow = true;
    spinGroup.add(tyre);

    const rim = new THREE.Mesh(wheelGeos.rim, materials.steel);
    rim.castShadow = true;
    spinGroup.add(rim);

    steerGroup.add(spinGroup);
    steerGroup.userData.spin = spinGroup;
    root.add(steerGroup);
    wheels.push(steerGroup);
  }

  // Live axles, visible under the truck when it articulates.
  const axleGeo = box(HALF_TRACK * 2 - 0.12, 0.13, 0.13);
  const axles = [0, 1].map(() => {
    const m = new THREE.Mesh(axleGeo, materials.trim);
    root.add(m);
    return m;
  });

  return {
    root,
    wheels,
    update(wheelStates: WheelState[]) {
      for (let i = 0; i < wheels.length && i < wheelStates.length; i++) {
        const s = wheelStates[i];
        const g = wheels[i];
        g.position.set(s.x, s.y, s.z);
        g.rotation.y = s.steer;
        (g.userData.spin as THREE.Group).rotation.x = s.spin;
      }
      const pairs: Array<[number, number]> = [[0, 1], [2, 3]];
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
  ], false, false);
  glassBand(b, [-1.62, 0.56], 0.855, 0.62, 1.14, 2);
  rakedScreen(b, 0.98, 0.62, 1.22, 0.78);
  b.add(box(1.52, 0.5, 0.06), 'glass', [0, 0.86, -2.0]);

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
  // Bed: a separate shell, slightly narrower, with its own tucked tail.
  shell(b, 'body', [
    { z: TAIL, hw: 0.86, y0: -0.44, y1: WAIST + 0.06, c: 0.11 },
    { z: -1.96, hw: 0.92, y0: -0.50, y1: WAIST + 0.06, c: 0.09 },
    { z: -0.36, hw: 0.92, y0: -0.50, y1: WAIST + 0.06, c: 0.09 },
  ]);
  // Bed well, cut *down* into that shell rather than stood on top of it. The
  // box has to sit with its top face level with the rail and its body below,
  // or the "well" reads as a crate strapped to the bed.
  b.add(box(1.48, 0.36, 1.56), 'bodyDark', [0, WAIST - 0.12, -1.16]);
  b.add(box(1.5, 0.05, 1.58), 'bodyDark', [0, WAIST - 0.29, -1.16]);

  // Crew cab: four doors, so the greenhouse runs most of the wheelbase.
  shell(b, 'body', [
    { z: -0.44, hw: 0.82, y0: WAIST, y1: 1.34, c: 0.08 },
    { z: -0.20, hw: 0.855, y0: WAIST, y1: 1.38, c: 0.08 },
    { z: 0.86, hw: 0.855, y0: WAIST, y1: 1.38, c: 0.08 },
    { z: 1.14, hw: 0.80, y0: WAIST, y1: 1.28, c: 0.10 },
  ], false, false);
  glassBand(b, [-0.14, 0.80], 0.865, 0.78, 1.26, 2);
  rakedScreen(b, 1.16, 0.80, 1.30, 0.82);
  b.add(box(1.5, 0.38, 0.06), 'glass', [0, 0.98, -0.46]);

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
  ], false, false);
  // Vertical windscreen — no rake at all, which is the whole silhouette.
  b.add(box(1.62, 0.68, 0.06), 'glass', [0, 0.98, 0.83]);
  b.add(box(1.72, 0.08, 0.14), 'trim', [0, 1.36, 0.81]);
  b.add(box(1.72, 0.09, 0.16), 'body', [0, 1.42, 0.84]);
  glassBand(b, [-1.66, 0.72], 0.865, 0.68, 1.3, 2);
  b.add(box(1.6, 0.5, 0.06), 'glass', [0, 1.0, TAIL + 0.02]);
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
 * Tube-frame dune buggy: a chassis, two seats, an engine, and daylight through
 * the middle of it.
 *
 * The trap is building a truck and deleting parts, which is what the body this
 * replaced did — it kept a full-width tub and read as a bathtub with a cage on
 * top. Here the structure *is* the silhouette, so the shell is a narrow shallow
 * pan and everything above the waist is tube.
 */
function buildBuggy(b: PartBuilder) {
  const NOSE = 1.9;
  const TAIL = -1.8;
  const T = 0.055;
  const RAIL = 0.64;

  // Pan: narrow, shallow, pinched to a point at the nose.
  shell(b, 'body', [
    { z: -1.34, hw: 0.62, y0: -0.36, y1: 0.06, c: 0.07 },
    { z: -0.5, hw: 0.70, y0: -0.38, y1: 0.10, c: 0.07 },
    { z: 0.62, hw: 0.70, y0: -0.38, y1: 0.10, c: 0.07 },
    { z: 1.12, hw: 0.64, y0: -0.36, y1: 0.02, c: 0.08 },
    { z: 1.62, hw: 0.44, y0: -0.30, y1: -0.02, c: 0.08 },
    { z: NOSE, hw: 0.22, y0: -0.24, y1: -0.06, c: 0.05 },
  ]);
  // Scuttle in front of the cockpit, the one panel that catches light up high.
  b.add(box(1.3, 0.3, 0.1), 'body', [0, 0.2, 0.72]);
  b.add(box(1.24, 0.1, 0.3), 'bodyDark', [0, 0.16, 0.56]);

  // Chassis rails, visible under and beside the pan.
  b.addPair(() => tube(3.4, 0.07), 'trim', [RAIL, -0.34, -0.05], [Math.PI / 2, 0, 0]);
  b.add(tube(1.26, 0.06), 'trim', [0, -0.34, 1.34], [0, 0, Math.PI / 2]);
  b.add(tube(1.26, 0.06), 'trim', [0, -0.34, -1.5], [0, 0, Math.PI / 2]);

  // Cockpit.
  b.addPair(() => box(0.4, 0.12, 0.44), 'cargo', [0.34, 0.14, -0.02]);
  b.addPair(() => box(0.4, 0.56, 0.12), 'cargo', [0.34, 0.44, -0.3]);
  b.addPair(() => box(0.28, 0.16, 0.1), 'trim', [0.34, 0.76, -0.3]);
  b.addPair(() => box(0.06, 0.5, 0.03), 'amber', [0.26, 0.46, -0.24], [0, 0, 0.12]);
  b.add(disc(0.17, 0.04, 10), 'trim', [0.34, 0.46, 0.5], [0.5, 0, 0]);

  // Engine, out behind the rear axle.
  shell(b, 'steel', [
    { z: -1.84, hw: 0.36, y0: -0.2, y1: 0.24, c: 0.07 },
    { z: -1.6, hw: 0.42, y0: -0.24, y1: 0.3, c: 0.07 },
    { z: -1.16, hw: 0.42, y0: -0.24, y1: 0.3, c: 0.07 },
  ]);
  b.addPair(() => tube(0.5, 0.045), 'chrome', [0.28, 0.24, -1.86], [1.1, 0.3, 0]);
  b.add(tube(1.05, 0.018), 'trim', [-0.48, 0.85, -1.6]);
  b.add(box(0.2, 0.14, 0.02), 'amber', [-0.48, 1.32, -1.6]);

  // Cage.
  b.addPair(() => tube(1.6, T), 'trim', [RAIL, 0.5, -0.3]);
  b.add(tube(1.32, T), 'trim', [0, 1.26, -0.3], [0, 0, Math.PI / 2]);
  b.addPair(() => tube(0.94, T), 'trim', [RAIL, 0.3, 0.88], [-0.22, 0, 0]);
  b.add(tube(1.32, T), 'trim', [0, 0.8, 0.96], [0, 0, Math.PI / 2]);
  b.addPair(() => tube(1.36, T), 'trim', [RAIL, 1.08, 0.32], [1.36, 0, 0]);
  b.addPair(() => tube(1.28, T), 'trim', [RAIL, 0.6, -1.04], [0.95, 0, 0]);
  b.add(tube(1.02, 0.04), 'trim', [0, 0.88, -0.3], [0, 0, 0.72]);

  // Lamps strapped to the front hoop, and tube bumpers.
  b.addPair(() => {
    const g = new THREE.CylinderGeometry(0.11, 0.11, 0.09, 10);
    g.rotateX(Math.PI / 2);
    return g;
  }, 'lamp', [0.32, 0.56, 1.02]);
  b.add(tube(1.3, 0.05), 'steel', [0, -0.24, NOSE - 0.04], [0, 0, Math.PI / 2]);
  b.add(tube(1.36, 0.05), 'steel', [0, -0.24, TAIL - 0.06], [0, 0, Math.PI / 2]);
  for (const side of [1, -1]) {
    b.add(box(0.16, 0.11, 0.05), 'brake', [side * 0.46, 0.02, TAIL - 0.1]);
  }
  // Skid plate in body colour, not bare steel: at this angle a pale slab
  // under the nose catches the sun and reads as a separate floating object.
  b.add(box(0.84, 0.05, 0.7), 'bodyDark', [0, -0.42, 1.2]);
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

/** A raked windscreen with its pillars, leaning back from `z`. */
function rakedScreen(b: PartBuilder, z: number, y0: number, y1: number, width: number) {
  const h = y1 - y0;
  b.add(box(width * 2, h + 0.06, 0.06), 'glass', [0, (y0 + y1) / 2, z - 0.06], [-0.24, 0, 0]);
  b.add(box(width * 2 + 0.08, 0.09, 0.1), 'trim', [0, y1 + 0.02, z - 0.19]);
  b.addPair(() => box(0.08, h + 0.06, 0.09), 'body', [width - 0.02, (y0 + y1) / 2, z - 0.07], [-0.24, 0, 0]);
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

const BODIES: Record<BodyId, BodySpec> = {
  wagon: { build: buildWagon },
  pickup: { build: buildPickup },
  gwagon: { build: buildGWagon },
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
