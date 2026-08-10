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
      const merged = mergeGeometries(geos, false);
      // The source geometries are transient scratch: merging copies their data,
      // so holding them any longer just pins buffers no mesh will ever draw.
      for (const g of geos) g.dispose();
      if (!merged) continue;
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
const WAIST_TOP = 0.45;
const ROOF_Y = 1.28;
const BONNET_TOP = 0.28;

/**
 * What the shared accessory builders need to know about a body. Fitting a light
 * bar or a spare shouldn't need a per-body branch inside every accessory, so
 * each body publishes its mounting points instead.
 */
interface BodySpec {
  noseZ: number;
  tailZ: number;
  /** Top surface a rack or light bar bolts to — roof for the closed bodies. */
  mountY: number;
  /** Front/rear z extent available to the roof rack. */
  rack: [number, number];
  /** Where a light bar sits, at the leading edge of the roof or cage. */
  barZ: number;
  /** Spares hang somewhere different on every body. */
  spare: 'tailgate' | 'bed' | 'deck';
  snorkelTopY: number;
  build(b: PartBuilder): void;
}

export function createVehicleView(config: VehicleConfig = DEFAULT_VEHICLE): VehicleView {
  const root = new THREE.Group();
  const materials = createMaterials(paintColor(config.paint));
  const b = new PartBuilder(materials);
  const spec = BODIES[config.body];

  spec.build(b);
  if (config.roofRack) buildRoofRack(b, spec);
  if (config.spare) buildSpare(b, spec);
  if (config.lightBar) buildLightBar(b, spec);
  if (config.snorkel) buildSnorkel(b, spec);
  if (config.sandLadders) buildSandLadders(b, spec, config.roofRack);

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

/**
 * The engine bay, stepped down from the waist, with the wings at bonnet height.
 * That step is most of what stops a boxy 4x4 reading as a single slab-sided
 * van, and it's clearly there on the reference — the bonnet line sits well
 * below the window line.
 */
function buildNose(b: PartBuilder, bayZ: number, bayDepth: number, cowlZ: number) {
  b.add(box(1.82, 1.0 - (WAIST_TOP - BONNET_TOP), bayDepth), 'body', [0, -0.14, bayZ]);
  // Bonnet lid, slightly proud and inset from the wings.
  b.add(box(1.74, 0.08, bayDepth - 0.14), 'body', [0, BONNET_TOP + 0.04, bayZ]);
  // Cowl bridging bonnet up to the waist, under the windscreen.
  b.add(box(1.78, 0.2, 0.3), 'body', [0, WAIST_TOP - 0.08, cowlZ]);
}

function buildFront(b: PartBuilder, noseZ: number) {
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
  b.add(box(1.94, 0.24, 0.3), 'chrome', [0, -0.28, noseZ + 0.06]);
  b.add(box(1.8, 0.2, 0.2), 'trim', [0, -0.48, noseZ + 0.02]);
  b.add(box(1.86, 0.12, 0.06), 'bodyDark', [0, -0.12, noseZ + 0.04]);
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

/** The upright windscreen a boxy 4x4 has, with its A-pillars and header rail. */
function buildWindscreen(b: PartBuilder, z: number, topY: number) {
  b.add(box(1.62, 0.78, 0.06), 'glass', [0, 0.9, z], [-0.26, 0, 0]);
  b.add(box(1.7, 0.1, 0.1), 'trim', [0, topY, z - 0.095]);
  b.addPair(() => box(0.08, 0.8, 0.1), 'body', [0.85, 0.9, z - 0.015], [-0.26, 0, 0]);
}

// --- bodies -------------------------------------------------------------------

/**
 * The wagon: the long-roof five-door the rest of the game was built around.
 */
function buildWagon(b: PartBuilder) {
  // Cabin and load area.
  b.add(box(BODY_HALF_W * 2, 1.0, 2.98), 'body', [0, -0.05, -0.6]);
  buildNose(b, 1.4, 1.34, 0.76);
  // Sill shadow line, which stops the flank reading as one flat wall.
  b.add(box(BODY_HALF_W * 2 + 0.01, 0.1, 3.7), 'bodyDark', [0, -0.5, -0.05]);

  // Cabin. The window band is built as a dark box with amber glass sitting
  // proud of it, so the gaps between panes read as pillars without modelling any.
  const capH = ROOF_Y - WAIST_TOP;
  const capMidY = WAIST_TOP + capH / 2;
  b.add(box(1.74, capH, 2.78), 'body', [0, capMidY, -0.64]);
  b.add(box(1.765, 0.68, 2.72), 'trim', [0, 0.88, -0.64]);
  b.add(box(1.78, 0.1, 2.86), 'body', [0, ROOF_Y - 0.05, -0.62]);

  // Side glass: door pane then a long fixed rear pane, split by a B-pillar gap.
  b.addPair(() => box(0.05, 0.54, 0.92), 'glass', [0.893, 0.88, 0.12]);
  b.addPair(() => box(0.05, 0.54, 1.34), 'glass', [0.893, 0.88, -1.22]);

  buildWindscreen(b, 0.815, 1.24);

  // Tailgate glass, sitting proud of the rear face — flush with it, the cabin
  // box swallows all but a sliver and the back of the truck reads as solid.
  b.add(box(1.6, 0.56, 0.06), 'glass', [0, 0.9, -2.08]);

  buildArchesAndSteps(b);
  buildFront(b, 2.12);
  buildRearLamps(b, -2.10);

  // Door shut lines, cut as thin dark inlays into the flank.
  b.addPair(() => box(0.02, 0.86, 0.03), 'bodyDark', [BODY_HALF_W, 0.0, 0.66]);
  b.addPair(() => box(0.02, 0.86, 0.03), 'bodyDark', [BODY_HALF_W, 0.0, -0.44]);
  b.addPair(() => box(0.02, 0.06, 1.1), 'bodyDark', [BODY_HALF_W, 0.43, 0.11]);
  b.addPair(() => box(0.04, 0.06, 0.22), 'trim', [BODY_HALF_W + 0.01, 0.2, -0.18]);

  buildMirrors(b, 0.72, 0.62);
  b.add(box(0.03, 0.11, 0.11), 'bodyDark', [-BODY_HALF_W - 0.005, 0.16, -1.5]);
  b.add(box(0.5, 0.02, 0.03), 'trim', [-0.3, 0.55, 0.98], [0, 0, 0.12]);
}

/**
 * Single-cab pickup. The silhouette job here is the gap: a short cab well
 * forward, then a long open bed, so the roofline stops halfway down the truck
 * instead of running to the tail like the wagon's.
 */
/**
 * Full-size American crew-cab pickup, in the F-series mould — proportions only,
 * built here from primitives, no badging or licensed geometry (§11).
 *
 * Three cues do almost all the work of making a truck read as *this* kind of
 * truck rather than a generic one, and none of them is detail:
 *
 *  - **The nose is tall and blunt**, and the grille is a single upright slab
 *    that fills most of it. Everything else in the game has a low bonnet with a
 *    letterbox grille under it; this one is a wall. It gets its own front rather
 *    than the shared `buildFront` for exactly that reason.
 *  - **The beltline is high and dead straight** from the headlamp to the
 *    tailgate, so the glasshouse looks shallow and the body deep.
 *  - **The bed rail steps up** over the rear arch. A flat-topped bed is the
 *    thing that makes a pickup read as a toy.
 */
function buildPickup(b: PartBuilder) {
  const NOSE = 2.16;
  const TAIL = -2.10;
  const CAB_BACK = -0.34;
  const BED_FLOOR = 0.42;
  const BED_WALL_H = 0.5;
  const wallMidY = BED_FLOOR + BED_WALL_H / 2;
  const bedMidZ = (CAB_BACK + TAIL) / 2;
  const bedDepth = CAB_BACK - TAIL;
  // Deeper flank than the other bodies: the waist sits higher and the bonnet
  // with it, which is the whole silhouette.
  const HIGH_WAIST = WAIST_TOP + 0.16;

  b.add(box(BODY_HALF_W * 2, 1.14, 3.2), 'body', [0, 0.02, -0.5]);
  b.add(box(BODY_HALF_W * 2 + 0.01, 0.1, 3.9), 'bodyDark', [0, -0.5, -0.05]);

  // Engine bay: tall, square, and barely stepped down from the waist at all.
  b.add(box(1.86, 0.72, 1.5), 'body', [0, 0.23, 1.38]);
  b.add(box(1.78, 0.08, 1.36), 'body', [0, 0.6, 1.38]);
  b.add(box(1.82, 0.2, 0.3), 'body', [0, HIGH_WAIST + 0.02, 0.72]);

  // Bed, floor sunk well below the rail so the walls read as walls.
  b.add(box(1.72, 0.06, bedDepth - 0.1), 'bodyDark', [0, BED_FLOOR, bedMidZ]);
  b.addPair(() => box(0.17, BED_WALL_H, bedDepth), 'body', [BODY_HALF_W - 0.085, wallMidY, bedMidZ]);
  b.add(box(1.86, BED_WALL_H, 0.12), 'body', [0, wallMidY, CAB_BACK - 0.04]);
  // The step in the rail, over the rear arch.
  b.addPair(() => box(0.19, 0.12, 0.86), 'body', [BODY_HALF_W - 0.085, wallMidY + BED_WALL_H / 2 + 0.06, -1.45]);
  // Tailgate: wide, with a pressed horizontal channel across it.
  b.add(box(1.86, BED_WALL_H + 0.1, 0.1), 'body', [0, wallMidY + 0.05, TAIL + 0.05]);
  b.add(box(1.6, 0.12, 0.04), 'bodyDark', [0, wallMidY + 0.08, TAIL + 0.09]);
  b.addPair(() => box(0.21, 0.05, bedDepth), 'trim', [BODY_HALF_W - 0.085, BED_FLOOR + BED_WALL_H, bedMidZ]);
  b.add(box(1.88, 0.05, 0.14), 'trim', [0, BED_FLOOR + BED_WALL_H + 0.1, TAIL + 0.05]);

  // Crew cab: four doors, so the cabin runs most of the wheelbase.
  const capH = ROOF_Y + 0.06 - HIGH_WAIST;
  const capMidY = HIGH_WAIST + capH / 2;
  const cabMidZ = 0.32;
  b.add(box(1.76, capH, 1.98), 'body', [0, capMidY, cabMidZ]);
  b.add(box(1.785, 0.5, 1.92), 'trim', [0, 1.0, cabMidZ]);
  b.add(box(1.8, 0.1, 2.06), 'body', [0, ROOF_Y + 0.01, cabMidZ]);
  // Two panes a side, split by a B-pillar — the crew-cab tell from any angle.
  b.addPair(() => box(0.05, 0.4, 0.78), 'glass', [0.903, 1.0, 0.72]);
  b.addPair(() => box(0.05, 0.4, 0.66), 'glass', [0.903, 1.0, -0.13]);
  b.addPair(() => box(0.06, 0.5, 0.06), 'body', [0.9, 1.0, 0.28]);
  b.add(box(1.62, 0.62, 0.06), 'glass', [0, 1.02, 0.98], [-0.2, 0, 0]);
  b.add(box(1.72, 0.1, 0.1), 'trim', [0, ROOF_Y + 0.02, 0.92]);
  b.addPair(() => box(0.08, 0.64, 0.1), 'body', [0.86, 1.02, 0.965], [-0.2, 0, 0]);
  b.add(box(1.6, 0.42, 0.06), 'glass', [0, 1.02, -0.38]);

  buildArchesAndSteps(b);

  // --- the face -------------------------------------------------------------
  // One upright slab of grille with a heavy surround, rather than the low
  // letterbox the other bodies wear.
  b.add(box(1.6, 0.54, 0.08), 'rubber', [0, 0.3, NOSE + 0.02]);
  for (let i = 0; i < 3; i++) {
    b.add(box(1.52, 0.05, 0.05), 'trim', [0, 0.12 + i * 0.18, NOSE + 0.06]);
  }
  b.add(box(1.72, 0.09, 0.09), 'chrome', [0, 0.6, NOSE + 0.03]);
  b.add(box(1.72, 0.09, 0.09), 'chrome', [0, 0.02, NOSE + 0.03]);
  // Square headlamps wrapping the corners, sat high on the wings.
  b.addPair(() => box(0.28, 0.26, 0.06), 'trim', [0.74, 0.34, NOSE + 0.02]);
  b.addPair(() => box(0.22, 0.19, 0.06), 'lamp', [0.74, 0.36, NOSE + 0.045]);
  b.addPair(() => box(0.2, 0.08, 0.06), 'amber', [0.74, 0.2, NOSE + 0.045]);
  b.add(box(1.96, 0.3, 0.32), 'chrome', [0, -0.22, NOSE + 0.05]);
  b.add(box(1.8, 0.16, 0.2), 'trim', [0, -0.46, NOSE + 0.01]);

  buildRearLamps(b, TAIL);

  // Door seams, handles and a fuel filler, on the high beltline.
  b.addPair(() => box(0.02, 1.0, 0.03), 'bodyDark', [BODY_HALF_W, 0.1, 1.3]);
  b.addPair(() => box(0.02, 1.0, 0.03), 'bodyDark', [BODY_HALF_W, 0.1, 0.28]);
  b.addPair(() => box(0.02, 1.0, 0.03), 'bodyDark', [BODY_HALF_W, 0.1, -0.36]);
  b.addPair(() => box(0.04, 0.06, 0.24), 'trim', [BODY_HALF_W + 0.01, 0.42, 0.78]);
  b.addPair(() => box(0.04, 0.06, 0.24), 'trim', [BODY_HALF_W + 0.01, 0.42, -0.06]);
  buildMirrors(b, 0.9, 0.82);
  b.add(box(0.03, 0.12, 0.12), 'bodyDark', [-BODY_HALF_W - 0.005, 0.3, -0.8]);
}

/**
 * The box wagon — a G-Class in proportion and stance, built from primitives
 * here, with no badging or licensed geometry (§11).
 *
 * This body is defined by what it *refuses* to do. Everything else in the game
 * has a raked windscreen, rounded shoulders and tucked-in details; this one is
 * orthogonal almost everywhere, and the handful of things that break the boxes
 * are the things people actually recognise it by:
 *
 *  - **The windscreen is vertical.** Not raked a little — vertical. It is the
 *    single strongest cue and the reason this doesn't use `buildWindscreen`.
 *  - **Indicator turrets stand on top of the front wings**, in the driver's
 *    eyeline so they mark where the corners are. Nothing else on any vehicle
 *    sits proud of the bonnet like that.
 *  - **Exposed door hinges** on the outside of the flank, and a grab handle on
 *    the A-pillar.
 *  - **The spare hangs on the back door**, always, not just as an accessory —
 *    the tail is wrong without it.
 */
function buildGWagon(b: PartBuilder) {
  const NOSE = 1.92;
  const TAIL = -1.82;
  const ROOF = 1.42;
  const SIDE = 0.9;

  // Slab flank, full height, no tumblehome: the sides are parallel plates.
  b.add(box(SIDE * 2, 1.06, 3.3), 'body', [0, -0.02, -0.28]);
  b.add(box(SIDE * 2 + 0.01, 0.1, 3.5), 'bodyDark', [0, -0.5, -0.28]);
  // Bonnet: flat, level with the waist, barely stepped down at all.
  b.add(box(1.8, 0.5, 1.16), 'body', [0, 0.26, 1.24]);
  b.add(box(1.72, 0.07, 1.04), 'body', [0, 0.53, 1.24]);

  // Greenhouse, inset a touch so the waist reads as a ledge running the length.
  const capH = ROOF - 0.56;
  b.add(box(1.72, capH, 2.42), 'body', [0, 0.56 + capH / 2, -0.44]);
  b.add(box(1.8, 0.09, 2.56), 'body', [0, ROOF - 0.045, -0.46]);
  // Rain gutters along the roof edge — a hard highlight line down each side.
  b.addPair(() => box(0.06, 0.07, 2.5), 'trim', [0.88, ROOF - 0.1, -0.46]);

  // Flat upright glass all round, with thin pillars between.
  b.addPair(() => box(0.05, 0.5, 1.0), 'glass', [0.873, 0.9, 0.12]);
  b.addPair(() => box(0.05, 0.5, 0.82), 'glass', [0.873, 0.9, -1.02]);
  b.addPair(() => box(0.07, capH, 0.07), 'body', [0.87, 0.56 + capH / 2, -0.44]);

  // The vertical windscreen.
  b.add(box(1.64, 0.6, 0.06), 'glass', [0, 0.92, 0.79]);
  b.add(box(1.72, 0.09, 0.12), 'trim', [0, ROOF - 0.08, 0.77]);
  b.addPair(() => box(0.08, 0.62, 0.09), 'body', [0.86, 0.92, 0.78]);
  b.add(box(1.68, 0.42, 0.06), 'glass', [0, 0.95, TAIL + 0.06]);

  buildArchesAndSteps(b);

  // --- the face -------------------------------------------------------------
  // Round headlamps standing proud in square surrounds, either side of a plain
  // slatted grille. The lamps sitting *on* the wing rather than inside it is
  // most of the front-end read.
  b.add(box(1.06, 0.34, 0.07), 'rubber', [0, 0.28, NOSE + 0.02]);
  for (let i = 0; i < 3; i++) {
    b.add(box(1.0, 0.04, 0.05), 'trim', [0, 0.16 + i * 0.12, NOSE + 0.055]);
  }
  b.addPair(() => {
    const g = new THREE.CylinderGeometry(0.16, 0.16, 0.09, 10);
    g.rotateX(Math.PI / 2);
    return g;
  }, 'lamp', [0.66, 0.3, NOSE + 0.04]);
  b.addPair(() => box(0.38, 0.38, 0.06), 'body', [0.66, 0.3, NOSE - 0.01]);
  b.add(box(1.9, 0.24, 0.26), 'trim', [0, -0.24, NOSE + 0.04]);

  // Indicator turrets on the wing tops.
  b.addPair(() => box(0.16, 0.1, 0.24), 'amber', [0.72, 0.61, NOSE - 0.26]);

  buildRearLamps(b, TAIL);

  // The door-mounted spare is left to the accessory builder rather than being
  // welded on here, even though this body is the one that most wants one. Built
  // in, it stacked on top of the accessory version whenever the toggle was on —
  // two wheels in the same 4 cm of air — and turning the toggle off left a
  // carrier with nothing in it. One owner for one part.
  //
  // What does stay is the carrier arm the wheel bolts to, off to one side the
  // way a side-hinged gate takes it.
  b.add(box(0.1, 0.44, 0.1), 'trim', [0.16, 0.16, TAIL - 0.1]);

  // Exposed hinges, flat handles, and the A-pillar grab handle.
  for (const z of [0.62, -0.42]) {
    b.addPair(() => box(0.06, 0.09, 0.12), 'trim', [SIDE + 0.02, 0.62, z]);
    b.addPair(() => box(0.06, 0.09, 0.12), 'trim', [SIDE + 0.02, 0.1, z]);
  }
  b.addPair(() => box(0.02, 0.9, 0.03), 'bodyDark', [SIDE, 0.06, 0.6]);
  b.addPair(() => box(0.02, 0.9, 0.03), 'bodyDark', [SIDE, 0.06, -0.44]);
  b.addPair(() => box(0.05, 0.05, 0.26), 'trim', [SIDE + 0.02, 0.36, 0.2]);
  b.addPair(() => box(0.05, 0.28, 0.05), 'trim', [SIDE + 0.02, 0.78, 0.66]);
  buildMirrors(b, 0.74, 0.78);
  b.add(box(0.03, 0.12, 0.12), 'bodyDark', [-SIDE - 0.005, 0.2, -1.3]);
}

/**
 * Tube-frame dune buggy: a chassis, two seats, an engine and nothing else.
 *
 * The trap here is building a truck and then deleting parts of it, which is
 * what the body this replaced did — it kept a full-width tub, so it read as a
 * bathtub with a cage on top rather than as a frame. A buggy is the other way
 * round: **the structure is the silhouette**, and the bodywork is a few panels
 * hung off it. So this is built tube-first, the tub is narrow and shallow, and
 * you can see the dune straight through the middle of the vehicle.
 *
 * It also skips almost every shared builder. No `buildNose` (there is no engine
 * bay at the front — the engine is behind the axle), no `buildFront` (no grille
 * to cool), and no arch flares, because there is no bodywork for a flare to be
 * proud of.
 */
function buildBuggy(b: PartBuilder) {
  const NOSE = 1.86;
  const TAIL = -1.78;
  const T = 0.055;
  const RAIL = 0.66;
  const HOOP_Y = 1.12;

  // --- chassis --------------------------------------------------------------
  // Two longitudinal rails the length of the car, cross-braced. Everything else
  // hangs off these.
  b.addPair(() => tube(3.5, 0.07), 'trim', [RAIL, -0.3, -0.05], [Math.PI / 2, 0, 0]);
  b.add(tube(1.3, 0.06), 'trim', [0, -0.3, 1.5], [0, 0, Math.PI / 2]);
  b.add(tube(1.3, 0.06), 'trim', [0, -0.3, -1.5], [0, 0, Math.PI / 2]);
  b.add(tube(1.3, 0.05), 'trim', [0, -0.3, 0.0], [0, 0, Math.PI / 2]);

  // Narrow floor pan and a low scuttle, the only real bodywork on the car.
  b.add(box(1.28, 0.06, 1.5), 'bodyDark', [0, -0.24, 0.05]);
  b.add(box(1.32, 0.34, 0.08), 'body', [0, -0.04, 0.82]);
  b.addPair(() => box(0.07, 0.3, 1.4), 'body', [0.64, -0.06, 0.05]);
  // Pointed nose cone, the one curved-ish panel on the vehicle.
  b.add(box(1.16, 0.3, 0.7), 'body', [0, -0.06, 1.28]);
  b.add(box(0.8, 0.2, 0.4), 'body', [0, -0.02, 1.68]);

  // --- cockpit --------------------------------------------------------------
  b.addPair(() => box(0.4, 0.12, 0.44), 'cargo', [0.36, 0.0, -0.02]);
  b.addPair(() => box(0.4, 0.56, 0.12), 'cargo', [0.36, 0.3, -0.3]);
  b.addPair(() => box(0.28, 0.16, 0.1), 'trim', [0.36, 0.62, -0.3]);
  // Harness straps over each seat back.
  b.addPair(() => box(0.06, 0.5, 0.03), 'amber', [0.28, 0.32, -0.24], [0, 0, 0.12]);
  b.add(box(0.9, 0.12, 0.26), 'bodyDark', [0, 0.16, 0.66]);
  // Steering wheel, visible because there is no roof or screen in the way.
  b.add(disc(0.17, 0.04, 10), 'trim', [0.36, 0.34, 0.5], [0.5, 0, 0]);

  // --- engine, behind the rear axle ----------------------------------------
  // The defining rear-end read: a bare block with headers curling out of it,
  // sat out in the open where a truck would have a load bed.
  b.add(box(0.8, 0.5, 0.66), 'steel', [0, -0.02, -1.42]);
  b.add(box(0.86, 0.1, 0.7), 'trim', [0, 0.25, -1.42]);
  b.addPair(() => tube(0.5, 0.045), 'chrome', [0.3, 0.16, -1.72], [1.1, 0.3, 0]);
  b.add(tube(0.7, 0.06), 'chrome', [0, 0.3, -1.9], [0, 0, Math.PI / 2]);
  // Whip antenna — the flag every buggy in the desert is required to fly.
  b.add(tube(1.5, 0.018), 'trim', [-0.5, 0.9, -1.6]);
  b.add(box(0.24, 0.16, 0.02), 'amber', [-0.5, 1.58, -1.6]);

  // --- cage -----------------------------------------------------------------
  // Matte black, like the sliders: bare steel tubing reads as pale spindly
  // sticks against a bright sky and loses its silhouette entirely.
  b.addPair(() => tube(1.5, T), 'trim', [RAIL, 0.4, -0.3]);
  b.add(tube(1.36, T), 'trim', [0, HOOP_Y, -0.3], [0, 0, Math.PI / 2]);
  // Forward hoop over the scuttle, and the roof rails joining the two.
  b.addPair(() => tube(0.9, T), 'trim', [RAIL, 0.18, 0.86], [-0.22, 0, 0]);
  b.add(tube(1.36, T), 'trim', [0, 0.66, 0.94], [0, 0, Math.PI / 2]);
  b.addPair(() => tube(1.3, T), 'trim', [RAIL, 0.94, 0.3], [1.36, 0, 0]);
  // Rear stays running back over the engine, and a diagonal across the hoop.
  b.addPair(() => tube(1.24, T), 'trim', [RAIL, 0.5, -1.02], [0.95, 0, 0]);
  b.add(tube(1.5, 0.04), 'trim', [0, 0.76, -0.3], [0, 0, 0.72]);

  // --- lights and bumpers ---------------------------------------------------
  // Lamps strapped to the front hoop rather than set into bodywork.
  b.addPair(() => {
    const g = new THREE.CylinderGeometry(0.11, 0.11, 0.09, 10);
    g.rotateX(Math.PI / 2);
    return g;
  }, 'lamp', [0.34, 0.42, 1.0]);
  b.add(tube(1.5, 0.05), 'steel', [0, -0.18, NOSE + 0.06], [0, 0, Math.PI / 2]);
  b.addPair(() => tube(0.5, 0.045), 'steel', [0.5, -0.24, NOSE - 0.14], [0, 0.5, 0]);
  b.add(tube(1.4, 0.05), 'steel', [0, -0.2, TAIL - 0.04], [0, 0, Math.PI / 2]);
  for (const side of [1, -1]) {
    b.add(box(0.16, 0.11, 0.05), 'brake', [side * 0.5, 0.0, TAIL - 0.06]);
  }

  // Skid plate under the nose — the only flat panel that catches light down low.
  b.add(box(1.1, 0.05, 0.9), 'steel', [0, -0.42, 1.2]);
}

const BODIES: Record<BodyId, BodySpec> = {
  wagon: {
    noseZ: 2.12,
    tailZ: -2.10,
    mountY: ROOF_Y,
    rack: [0.75, -1.75],
    barZ: 0.74,
    spare: 'tailgate',
    snorkelTopY: ROOF_Y + 0.3,
    build: buildWagon,
  },
  pickup: {
    noseZ: 2.16,
    tailZ: -2.10,
    // Crew cab roof sits higher than the others', so the rack and bar follow it.
    mountY: ROOF_Y + 0.06,
    rack: [1.2, -0.36],
    barZ: 0.98,
    spare: 'bed',
    snorkelTopY: ROOF_Y + 0.36,
    build: buildPickup,
  },
  gwagon: {
    noseZ: 1.92,
    tailZ: -1.82,
    mountY: 1.42,
    rack: [0.7, -1.68],
    barZ: 0.72,
    // The door-mounted spare is part of this body, so the accessory toggle has
    // nowhere useful left to put one — it hangs on the bed rail equivalent.
    spare: 'tailgate',
    snorkelTopY: 1.72,
    build: buildGWagon,
  },
  buggy: {
    // No roof: the rack and light bar mount to the cage, which is much lower
    // and much shorter than any of the closed bodies' roofs.
    noseZ: 1.86,
    tailZ: -1.78,
    mountY: 1.12,
    rack: [0.2, -0.8],
    barZ: 0.94,
    spare: 'deck',
    snorkelTopY: 1.44,
    build: buildBuggy,
  },
};

// --- accessories --------------------------------------------------------------

function buildRoofRack(b: PartBuilder, spec: BodySpec) {
  const [front, back] = spec.rack;
  const railY = spec.mountY + 0.09;
  const length = front - back;
  const midZ = (front + back) / 2;

  b.addPair(() => box(0.05, 0.05, length), 'trim', [0.74, railY, midZ]);
  // Slats every ~0.4m, however long the rack ended up on this body.
  const slats = Math.max(2, Math.round(length / 0.4));
  for (let i = 0; i <= slats; i++) {
    b.add(box(1.53, 0.045, 0.045), 'trim', [0, railY, back + (length * i) / slats]);
  }
  // Short legs lifting the rack off the roof.
  for (const z of [front - 0.1, back + 0.1]) {
    b.addPair(() => box(0.05, 0.09, 0.05), 'trim', [0.74, spec.mountY + 0.03, z]);
  }
  // Cargo box strapped to the front of the rack.
  const boxDepth = Math.min(1.0, length - 0.3);
  const boxZ = front - 0.16 - boxDepth / 2;
  b.add(box(0.92, 0.3, boxDepth), 'cargo', [0, railY + 0.18, boxZ]);
  b.add(box(0.94, 0.05, boxDepth + 0.02), 'trim', [0, railY + 0.33, boxZ]);
}

function buildSpare(b: PartBuilder, spec: BodySpec) {
  if (spec.spare === 'tailgate') {
    // Offset the way a side-hinged gate carries it.
    const z = spec.tailZ - 0.26;
    b.add(disc(0.4, 0.2, 14), 'rubber', [0.16, 0.06, z]);
    b.add(disc(0.23, 0.22, 12), 'steel', [0.16, 0.06, z - 0.01]);
    b.add(box(0.12, 0.12, 0.24), 'trim', [0.16, 0.06, z + 0.16]);
    return;
  }
  if (spec.spare === 'bed') {
    // Stood against the bulkhead, off to one side, where a bed spare rides.
    b.add(disc(0.4, 0.2, 14), 'rubber', [0.42, 0.72, -0.82]);
    b.add(disc(0.23, 0.22, 12), 'steel', [0.42, 0.72, -0.81]);
    b.add(box(0.06, 0.9, 0.05), 'trim', [0.42, 0.6, -0.72]);
    return;
  }
  // Runner: laid flat on the open deck, because there's no gate and no bulkhead.
  b.add(new THREE.CylinderGeometry(0.4, 0.4, 0.2, 14), 'rubber', [0.32, 0.14, -1.42]);
  b.add(new THREE.CylinderGeometry(0.23, 0.23, 0.22, 12), 'steel', [0.32, 0.14, -1.42]);
}

/**
 * Light bar across the leading edge of the roof or cage. Sits proud and high on
 * purpose: mounted flush it disappears into the roofline from the chase camera,
 * which is the only angle the player ever sees it from.
 */
function buildLightBar(b: PartBuilder, spec: BodySpec) {
  const y = spec.mountY + 0.16;
  b.add(box(1.24, 0.13, 0.11), 'trim', [0, y, spec.barZ]);
  for (let i = 0; i < 5; i++) {
    b.add(box(0.18, 0.1, 0.03), 'lamp', [-0.44 + i * 0.22, y, spec.barZ + 0.06]);
  }
  b.addPair(() => box(0.05, 0.14, 0.05), 'trim', [0.56, spec.mountY + 0.07, spec.barZ]);
}

/** Airbox duct up the passenger-side A-pillar, in matte black plastic. */
function buildSnorkel(b: PartBuilder, spec: BodySpec) {
  const bottom = -0.05;
  const top = spec.snorkelTopY;
  const height = top - bottom;
  b.add(box(0.12, height, 0.12), 'trim', [0.97, bottom + height / 2, 0.6]);
  // Forward-facing ram head, wider than the duct so it reads from behind too.
  b.add(box(0.17, 0.3, 0.2), 'trim', [0.97, top - 0.08, 0.68]);
  b.add(box(0.19, 0.06, 0.19), 'rubber', [0.97, top - 0.24, 0.69]);
  b.add(box(0.15, 0.05, 0.14), 'rubber', [0.97, 0.42, 0.61]);
}

/**
 * Recovery ladders. On the rack they hang off its outer rails, which is both
 * how they're actually carried and the only placement that stays visible from
 * directly behind; with no rack they drop to the flank above the sliders.
 */
function buildSandLadders(b: PartBuilder, spec: BodySpec, onRack: boolean) {
  const x = onRack ? 0.8 : BODY_HALF_W + 0.06;
  // Flank mount sits below the door handles rather than across them, which read
  // as one confused lump of black trim when they overlapped.
  const y = onRack ? spec.mountY + 0.24 : -0.04;
  const [front, back] = spec.rack;
  const z = onRack ? (front + back) / 2 - 0.15 : -0.35;
  const length = onRack ? Math.min(1.6, front - back - 0.2) : 1.4;

  b.addPair(() => box(0.05, 0.3, length), 'amber', [x, y, z]);
  const rungs = Math.max(3, Math.round(length / 0.24));
  for (let i = 0; i < rungs; i++) {
    const rz = z - length / 2 + (length * (i + 0.5)) / rungs;
    b.addPair(() => box(0.07, 0.14, 0.05), 'trim', [x, y, rz]);
  }
}

/**
 * Wheels. The tyre is most of what you see and the dish is a bit over half the
 * diameter, matching the reference's proportions.
 *
 * Every style resolves to exactly two geometries — one rubber, one steel — so
 * the dark cut-outs are merged into the *tyre* geometry rather than being their
 * own meshes. Four wheels therefore cost 8 draw calls whichever style is
 * fitted, instead of scaling with how detailed the rim looks.
 */
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
