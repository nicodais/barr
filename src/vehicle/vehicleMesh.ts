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

/**
 * The truck: a boxy, upright, live-axle-era 4x4 in the flat-shaded style (§4).
 *
 * Proportions follow a Patrol Super Safari as a *visual reference only* — every
 * piece here is built from primitives in-house, and there is deliberately no
 * badging or maker's mark of any kind, because §11 rules out reproducing
 * trademarked identifiers even when the silhouette is the thing being evoked.
 *
 * All the static bodywork is merged down to one mesh per material, so the whole
 * vehicle costs a handful of draw calls instead of the ~40 it takes to build.
 * Only the wheels stay separate, because they steer and spin.
 */
export interface VehicleView {
  root: THREE.Group;
  wheels: THREE.Group[];
  update(wheels: WheelState[]): void;
}

// Warm, limited, and readable against ochre sand (§4).
const PALETTE = {
  body: 0x4f8b60,
  bodyDark: 0x3f7350,
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
    color: PALETTE.glass,
    emissive: 0x6b4518,
    flatShading: true,
  });
}

const MATERIALS = {
  body: mat(PALETTE.body),
  bodyDark: mat(PALETTE.bodyDark),
  glass: glassMat(),
  trim: mat(PALETTE.trim),
  rubber: mat(PALETTE.rubber),
  chrome: mat(PALETTE.chrome),
  steel: mat(PALETTE.steel),
  lamp: mat(PALETTE.lamp),
  amber: mat(PALETTE.amber),
  brake: mat(PALETTE.brake),
  cargo: mat(PALETTE.cargo),
};

type MatKey = keyof typeof MATERIALS;

/** Collects transformed geometry per material so it can be merged in one pass. */
class PartBuilder {
  private parts = new Map<MatKey, THREE.BufferGeometry[]>();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);

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
      const merged = mergeGeometries(geos, false);
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, MATERIALS[key]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      meshes.push(mesh);
    }
    return meshes;
  }
}

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

// --- key dimensions -----------------------------------------------------------
// These describe the *bodywork* and are free to overhang the collider — bumpers,
// flares and the tailgate spare all stick out past it, exactly as they would on
// the real thing. The physics box is unchanged.
const BODY_HALF_W = 0.92;
const WAIST_TOP = 0.45;
const ROOF_Y = 1.28;
const NOSE_Z = 2.12;
const TAIL_Z = -2.10;

export function createVehicleView(): VehicleView {
  const root = new THREE.Group();
  const b = new PartBuilder();

  buildBody(b);
  buildGreenhouse(b);
  buildArchesAndSteps(b);
  buildFront(b);
  buildRear(b);
  buildRoofRack(b);
  buildDetails(b);

  for (const mesh of b.build()) root.add(mesh);

  // --- wheels ---------------------------------------------------------------
  const wheelGeos = buildWheelGeometry();

  const wheels: THREE.Group[] = [];
  for (let i = 0; i < 4; i++) {
    // Outer group carries steering + suspension position, inner carries spin.
    const steerGroup = new THREE.Group();
    const spinGroup = new THREE.Group();

    const tyre = new THREE.Mesh(wheelGeos.tyre, MATERIALS.rubber);
    tyre.castShadow = true;
    spinGroup.add(tyre);

    const rim = new THREE.Mesh(wheelGeos.rim, MATERIALS.steel);
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
    const m = new THREE.Mesh(axleGeo, MATERIALS.trim);
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
  };
}

/**
 * Lower body, in two heights. The cabin and load area run at full waist height;
 * the engine bay ahead of the cowl steps down. That step is most of what stops
 * a boxy 4x4 reading as a single slab-sided van, and it's clearly there on the
 * reference — the bonnet line sits well below the window line.
 */
function buildBody(b: PartBuilder) {
  const BONNET_TOP = 0.28;

  // Cabin and load area.
  b.add(box(BODY_HALF_W * 2, 1.0, 2.98), 'body', [0, -0.05, -0.6]);
  // Engine bay, stepped down, with the wings at bonnet height.
  b.add(box(1.82, 1.0 - (WAIST_TOP - BONNET_TOP), 1.34), 'body', [0, -0.14, 1.4]);
  // Bonnet lid, slightly proud and inset from the wings.
  b.add(box(1.74, 0.08, 1.2), 'body', [0, BONNET_TOP + 0.04, 1.4]);
  // Cowl bridging bonnet up to the waist, under the windscreen.
  b.add(box(1.78, 0.2, 0.3), 'body', [0, WAIST_TOP - 0.08, 0.76]);
  // Sill shadow line, which stops the flank reading as one flat wall.
  b.add(box(BODY_HALF_W * 2 + 0.01, 0.1, 3.7), 'bodyDark', [0, -0.5, -0.05]);
}

/**
 * Cabin. The window band is built as a dark box with amber glass sitting proud
 * of it, so the gaps between panes read as pillars without modelling any.
 */
function buildGreenhouse(b: PartBuilder) {
  const capH = ROOF_Y - WAIST_TOP;
  const capMidY = WAIST_TOP + capH / 2;

  b.add(box(1.74, capH, 2.78), 'body', [0, capMidY, -0.64]);
  // Dark band through the glazing height.
  b.add(box(1.765, 0.68, 2.72), 'trim', [0, 0.88, -0.64]);
  b.add(box(1.78, 0.1, 2.86), 'body', [0, ROOF_Y - 0.05, -0.62]);

  // Side glass: door pane then a long fixed rear pane, split by a B-pillar gap.
  b.addPair(() => box(0.05, 0.54, 0.92), 'glass', [0.893, 0.88, 0.12]);
  b.addPair(() => box(0.05, 0.54, 1.34), 'glass', [0.893, 0.88, -1.22]);

  // Windscreen, upright the way a boxy 4x4's is.
  b.add(box(1.62, 0.78, 0.06), 'glass', [0, 0.9, 0.815], [-0.26, 0, 0]);
  b.add(box(1.7, 0.1, 0.1), 'trim', [0, 1.24, 0.72]);

  // Tailgate glass, sitting proud of the rear face — flush with it, the cabin
  // box swallows all but a sliver and the back of the truck reads as solid.
  b.add(box(1.6, 0.56, 0.06), 'glass', [0, 0.9, -2.08]);

  // A-pillars, tying windscreen to roof.
  b.addPair(() => box(0.08, 0.8, 0.1), 'body', [0.85, 0.9, 0.8], [-0.26, 0, 0]);
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

function buildFront(b: PartBuilder) {
  // Grille: a dark recess with slats catching a little light across it.
  b.add(box(0.98, 0.3, 0.07), 'rubber', [0, 0.13, NOSE_Z + 0.015]);
  for (let i = 0; i < 3; i++) {
    b.add(box(0.92, 0.03, 0.04), 'trim', [0, 0.03 + i * 0.1, NOSE_Z + 0.045]);
  }

  // Headlamps sit in dark surrounds outboard of the grille, indicators beyond.
  b.addPair(() => box(0.3, 0.24, 0.05), 'trim', [0.66, 0.14, NOSE_Z + 0.015]);
  b.addPair(() => box(0.24, 0.17, 0.05), 'lamp', [0.66, 0.14, NOSE_Z + 0.04]);
  b.addPair(() => box(0.1, 0.13, 0.05), 'amber', [0.86, 0.13, NOSE_Z + 0.03]);

  // Bumper with a valance under it.
  b.add(box(1.94, 0.24, 0.3), 'chrome', [0, -0.28, NOSE_Z + 0.06]);
  b.add(box(1.8, 0.2, 0.2), 'trim', [0, -0.48, NOSE_Z + 0.02]);
  b.add(box(1.86, 0.12, 0.06), 'bodyDark', [0, -0.12, NOSE_Z + 0.04]);
}

function buildRear(b: PartBuilder) {
  // Vertical lamp clusters: brake over reverse over indicator.
  for (const side of [1, -1]) {
    b.add(box(0.2, 0.2, 0.06), 'brake', [side * 0.72, 0.16, TAIL_Z - 0.03]);
    b.add(box(0.2, 0.1, 0.06), 'lamp', [side * 0.72, -0.0, TAIL_Z - 0.03]);
    b.add(box(0.2, 0.16, 0.06), 'amber', [side * 0.72, -0.14, TAIL_Z - 0.03]);
  }

  b.add(box(1.94, 0.24, 0.28), 'chrome', [0, -0.28, TAIL_Z - 0.06]);
  b.add(box(0.42, 0.2, 0.04), 'lamp', [0.0, -0.12, TAIL_Z - 0.04]);

  // Tailgate-mounted spare, offset the way a side-hinged gate carries it.
  const spareZ = TAIL_Z - 0.26;
  const tyre = new THREE.CylinderGeometry(0.4, 0.4, 0.2, 14);
  tyre.rotateX(Math.PI / 2);
  b.add(tyre, 'rubber', [0.16, 0.06, spareZ]);
  const spareRim = new THREE.CylinderGeometry(0.23, 0.23, 0.22, 12);
  spareRim.rotateX(Math.PI / 2);
  b.add(spareRim, 'steel', [0.16, 0.06, spareZ - 0.01]);
  b.add(box(0.12, 0.12, 0.24), 'trim', [0.16, 0.06, spareZ + 0.16]);
}

function buildRoofRack(b: PartBuilder) {
  const railY = ROOF_Y + 0.09;
  b.addPair(() => box(0.05, 0.05, 2.5), 'trim', [0.74, railY, -0.5]);
  for (const z of [0.68, -0.1, -0.88, -1.66]) {
    b.add(box(1.53, 0.045, 0.045), 'trim', [0, railY, z]);
  }
  // Short legs lifting the rack off the roof.
  for (const z of [0.6, -1.6]) {
    b.addPair(() => box(0.05, 0.09, 0.05), 'trim', [0.74, ROOF_Y + 0.03, z]);
  }
  // Cargo box strapped to the front of the rack.
  b.add(box(0.92, 0.3, 1.0), 'cargo', [0, railY + 0.18, 0.05]);
  b.add(box(0.94, 0.05, 1.02), 'trim', [0, railY + 0.33, 0.05]);
}

function buildDetails(b: PartBuilder) {
  // Door shut lines, cut as thin dark inlays into the flank.
  b.addPair(() => box(0.02, 0.86, 0.03), 'bodyDark', [BODY_HALF_W, 0.0, 0.66]);
  b.addPair(() => box(0.02, 0.86, 0.03), 'bodyDark', [BODY_HALF_W, 0.0, -0.44]);
  b.addPair(() => box(0.02, 0.06, 1.1), 'bodyDark', [BODY_HALF_W, 0.43, 0.11]);

  // Handles.
  b.addPair(() => box(0.04, 0.06, 0.22), 'trim', [BODY_HALF_W + 0.01, 0.2, -0.18]);

  // Mirrors on stalks at the A-pillar.
  b.addPair(() => box(0.14, 0.03, 0.03), 'trim', [1.0, 0.62, 0.72]);
  b.addPair(() => box(0.06, 0.16, 0.11), 'trim', [1.07, 0.62, 0.72]);

  // Snorkel-free: just a fuel filler and a wiper, for scale cues.
  b.add(box(0.03, 0.11, 0.11), 'bodyDark', [-BODY_HALF_W - 0.005, 0.16, -1.5]);
  b.add(box(0.5, 0.02, 0.03), 'trim', [-0.3, 0.55, 0.98], [0, 0, 0.12]);
}

/**
 * Steel wheel: a small grey dish punched with six holes, sitting inside a fat
 * black tyre — the reference's proportions, where the tyre is most of what you
 * see and the dish is a bit over half the diameter.
 *
 * The holes are cut in the *rubber* material and merged into the tyre geometry,
 * so six dark holes across four wheels cost no extra draw calls at all.
 */
function buildWheelGeometry(): { tyre: THREE.BufferGeometry; rim: THREE.BufferGeometry } {
  const tyreParts: THREE.BufferGeometry[] = [];
  const rimParts: THREE.BufferGeometry[] = [];

  const tread = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, WHEEL_WIDTH, 14);
  tread.rotateZ(Math.PI / 2);
  tyreParts.push(tread);

  // Dish proud of the tread on both faces so it reads from either side.
  const dish = new THREE.CylinderGeometry(0.245, 0.245, WHEEL_WIDTH + 0.04, 12);
  dish.rotateZ(Math.PI / 2);
  rimParts.push(dish);

  const hub = new THREE.CylinderGeometry(0.085, 0.085, WHEEL_WIDTH + 0.08, 8);
  hub.rotateZ(Math.PI / 2);
  rimParts.push(hub);

  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const hole = new THREE.CylinderGeometry(0.048, 0.048, WHEEL_WIDTH + 0.07, 6);
    hole.rotateZ(Math.PI / 2);
    hole.translate(0, Math.cos(a) * 0.155, Math.sin(a) * 0.155);
    tyreParts.push(hole);
  }

  const tyre = mergeGeometries(tyreParts, false) ?? tread;
  const rim = mergeGeometries(rimParts, false) ?? dish;
  tyre.computeBoundingSphere();
  rim.computeBoundingSphere();
  return { tyre, rim };
}
