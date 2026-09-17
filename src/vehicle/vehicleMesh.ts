import { bucketSeat, springBetween, steeringWheel, rollHoop } from './detailGeometry';
import * as THREE from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  AXLE_HEIGHT,
  HALF_TRACK,
  HALF_WHEELBASE,
  WHEEL_RADIUS,
  WHEEL_WIDTH,
} from './VehicleTuning';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { WheelState } from './Vehicle';
import {
  DEFAULT_VEHICLE,
  paintColor,
  type BodyId,
  type VehicleConfig,
  type WheelStyleId,
} from './vehicleConfig';

/**
 * Four independently authored vehicle bodies, with shaped panels, hollow
 * cabins, articulated running gear and physically based finishes (§4).
 *
 * Proportions follow a Patrol Super Safari as a *visual reference only* — every
 * piece here is built from primitives in-house, and there is deliberately no
 * badging or maker's mark of any kind, because §11 rules out reproducing
 * trademarked identifiers even when the silhouette is the thing being evoked.
 *
 * Every body hangs on the same collider, wheelbase and track (VehicleTuning):
 * each body retains its existing handling configuration.
 *
 * All the static bodywork is merged down to one mesh per material, so the whole
 * vehicle costs a handful of draw calls instead of the ~60 it takes to build.
 * Only the wheels stay separate, because they steer and spin.
 */
export interface VehicleView {
  root: THREE.Group;
  rideHeight: number;
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
  glass: 0x17272c,
  trim: 0x24262a,
  rubber: 0x242321,
  // Muted rather than bright: at a low sun a near-white bumper blows out to a
  // flat white block and reads as missing geometry.
  chrome: 0x8f9499,
  steel: 0x8d939a,
  lamp: 0xf3ead6,
  amber: 0xd9822b,
  brake: 0xa8342c,
  cargo: 0x49543f,
};

function mat(color: number, roughness = 0.8, metalness = 0): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

/** Clearcoat is a separate specular layer over pigment. Dust gathers low on
 * the body and breaks up that reflection without painting over the windows. */
function paintMat(color: number): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial({
    color, roughness: 0.24, metalness: 0.10,
    clearcoat: 0.85, clearcoatRoughness: 0.10, envMapIntensity: 1.15,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vBodyPosition;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vBodyPosition = position;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vBodyPosition;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float dust = (1.0 - smoothstep(-0.45, 0.38, vBodyPosition.y))
          * (0.22 + 0.06 * sin(vBodyPosition.z * 31.0 + vBodyPosition.y * 8.0));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.32, 0.25, 0.17), dust);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.85, dust);`);
  };
  material.customProgramCacheKey = () => 'shamal-dusty-clearcoat-v1';
  return material;
}

type Materials = ReturnType<typeof createMaterials>;
type MatKey = keyof Materials;

function createMaterials(paint: number) {
  const dark = new THREE.Color(paint).multiplyScalar(0.82);
  return {
    body: paintMat(paint),
    bodyDark: paintMat(dark.getHex()),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0x344647, roughness: 0.095, metalness: 0.06, transparent: true, opacity: 0.78, depthWrite: false, side: THREE.DoubleSide,
      clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.35,
    }),
    trim: mat(FIXED_PALETTE.trim, 0.4, 0.32),
    rubber: mat(FIXED_PALETTE.rubber, 0.96),
    chrome: mat(FIXED_PALETTE.chrome, 0.2, 0.95),
    steel: mat(FIXED_PALETTE.steel, 0.34, 0.82),
    lamp: new THREE.MeshPhysicalMaterial({
      color: FIXED_PALETTE.lamp, roughness: 0.16, metalness: 0.35, clearcoat: 1,
    }),
    amber: mat(FIXED_PALETTE.amber, 0.26, 0.12),
    brake: mat(FIXED_PALETTE.brake, 0.2, 0.18),
    cargo: mat(FIXED_PALETTE.cargo, 0.94),
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

  constructor(private materials: Materials, private upperBodyDrop = 0) {}

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
    if (this.upperBodyDrop > 0) {
      // Lower the beltline without squashing the greenhouse or its openings.
      const p = geo.getAttribute('position'), n = geo.getAttribute('normal');
      const normal = new THREE.Vector3();
      for (let i=0;i<p.count;i++) {
        const y=p.getY(i), t=THREE.MathUtils.clamp((y+.15)/.65,0,1);
        p.setY(i,y-this.upperBodyDrop*t*t*(3-2*t));
        const derivative=1-this.upperBodyDrop*6*t*(1-t)/.65;
        normal.set(n.getX(i),n.getY(i)/derivative,n.getZ(i)).normalize();
        n.setXYZ(i,normal.x,normal.y,normal.z);
      }
    }

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
    const geo = new THREE.CylinderGeometry(radius, radius, len, 32);
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

const box = (w: number, h: number, d: number) =>
  new RoundedBoxGeometry(w, h, d, 2, Math.min(0.035, w * 0.12, h * 0.12, d * 0.12));
/** Cage/bar tubing. Six sides is plenty at this scale and keeps the facet look. */
const tube = (len: number, r = 0.045) => new THREE.CylinderGeometry(r, r, len, 32);
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
  const spec = BODIES[config.body];
  const twoWheeled = spec.twoWheeled === true;
  const b = new PartBuilder(materials, twoWheeled || config.body === 'buggy' ? 0 : 0.18);

  const isUTV = config.body === 'buggy';
  const visualAxle = twoWheeled ? .75 : isUTV ? 1.15 : HALF_WHEELBASE;
  spec.build(b);
  if (!twoWheeled && !isUTV) {
    for (const z of [-HALF_WHEELBASE, HALF_WHEELBASE]) {
      const differential = new THREE.SphereGeometry(0.13, 16, 12);
      differential.scale(1.35, .78, .85);
      b.add(differential, 'trim', [0, AXLE_HEIGHT - 0.4, z]);
      for (const side of [-1, 1]) {
        b.strut('steel', [side * 0.66, -0.29, z + 0.1], [side * 0.76, -0.65, z - 0.13], 0.036);
        for (let i = 0; i < 8; i++) {
          const coil = new THREE.TorusGeometry(0.063, 0.009, 5, 16);
          b.add(coil, 'trim', [side * 0.66, -0.30 - i * 0.036, z + 0.1], [Math.PI / 2, 0, 0]);
        }
      }
    }
    b.strut('steel', [0, -0.55, -1.4], [0, -0.43, 1.4], 0.045);
  }

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
  const wheelGeos = twoWheeled ? buildDirtWheel(.35, .075) : buildWheelGeometry(isUTV ? 'beadlock' : config.wheels);
  const rearWheelGeos = twoWheeled ? buildDirtWheel(.33, .10) : wheelGeos;

  const wheels: THREE.Group[] = [];
  for (let i = 0; i < (twoWheeled ? 2 : 4); i++) {
    // Outer group carries steering + suspension position, inner carries spin.
    const steerGroup = new THREE.Group();
    const spinGroup = new THREE.Group();

    const tyre = new THREE.Mesh((twoWheeled && i === 1 ? rearWheelGeos : wheelGeos).tyre, materials.rubber);
    tyre.castShadow = true;
    spinGroup.add(tyre);

    const rim = new THREE.Mesh((twoWheeled && i === 1 ? rearWheelGeos : wheelGeos).rim, materials.steel);
    rim.castShadow = true;
    spinGroup.add(rim);

    if (isUTV) spinGroup.scale.set(1.05, .40/.42, .40/.42);
    steerGroup.add(spinGroup);
    steerGroup.userData.spin = spinGroup;
    hull.add(steerGroup);
    steerGroup.position.set(twoWheeled ? 0 : (i % 2 === 0 ? -1 : 1) * (isUTV ? .82 : HALF_TRACK),
      GROUND_Y + (twoWheeled ? i === 0 ? .35 : .33 : isUTV ? .40 : .42), (twoWheeled ? i === 0 : i < 2) ? visualAxle : -visualAxle);
    wheels.push(steerGroup);
  }

  // Suspension members terminate at the actual animated hubs, not rest-pose guesses.
  const linkGeo=new THREE.CylinderGeometry(1,1,1,12);
  const coilGeo=springBetween(new THREE.Vector3(),new THREE.Vector3(0,1,0),.048);
  const links: Array<{ mesh: THREE.Mesh; top: THREE.Vector3; offset: THREE.Vector3; wheel: number; radius: number; coil: boolean }> = [];
  const link=(top: [number,number,number], wheel: number, offset: [number,number,number], radius: number, key: MatKey, coil=false)=>{
    const mesh=new THREE.Mesh(coil?coilGeo:linkGeo,materials[key]);mesh.castShadow=true;hull.add(mesh);
    links.push({mesh,top:new THREE.Vector3(...top),offset:new THREE.Vector3(...offset),wheel,radius,coil});
  };
  if(isUTV) for(let i=0;i<4;i++) {
    const side=i%2===0?-1:1,z=i<2?1.15:-1.15;
    for(const dz of [-.23,.23]) link([side*.38,-.43,z+dz],i,[0,0,0],.025,'steel');
    link([side*.42,-.18,z-.08],i,[-side*.03,.10,0],.023,'trim');
    link([side*.48,.01,z-.08],i,[-side*.05,.07,0],.017,'chrome');
    link([side*.48,.01,z-.08],i,[-side*.05,.07,0],1,'amber',true);
    link([0,-.50,z],i,[0,0,0],.020,'trim');
  }
  if(twoWheeled) for(const side of [-1,1]) {
    link([side*.105,-.30,.625],0,[side*.105,0,0],.018,'chrome');
    link([side*.115,-.54,-.12],1,[side*.115,0,0],.034,'steel');
  }
  const endpoint=new THREE.Vector3(), axis=new THREE.Vector3(), up=new THREE.Vector3(0,1,0);
  const updateLinks=()=>{for(const l of links){
    endpoint.copy(l.offset).applyAxisAngle(up,wheels[l.wheel].rotation.y).add(wheels[l.wheel].position);
    axis.copy(endpoint).sub(l.top);const length=axis.length();
    l.mesh.quaternion.setFromUnitVectors(up,axis.normalize());
    l.mesh.position.copy(l.coil?l.top:endpoint.add(l.top).multiplyScalar(.5));
    l.mesh.scale.set(l.coil?1:l.radius,length,l.coil?1:l.radius);
  }};
  updateLinks();

  // Live axles, visible under the truck when it articulates. A bike has none,
  // and drawing a beam across a chassis whose width it does not admit to would
  // give the whole trick away.
  const axleGeo = box(HALF_TRACK * 2 - 0.12, 0.13, 0.13);
  const axles = twoWheeled || isUTV ? [] : [0, 1].map((a) => {
    const m = new THREE.Mesh(axleGeo, materials.trim);
    m.position.set(0, AXLE_HEIGHT - 0.4, a === 0 ? HALF_WHEELBASE : -HALF_WHEELBASE);
    hull.add(m);
    return m;
  });

  return {
    root,
    rideHeight: -GROUND_Y,
    wheels,
    update(wheelStates: WheelState[], speed = 0) {
      if (twoWheeled) {
        // Each drawn wheel is the mean of its axle pair, pulled onto x=0.
        for (let i = 0; i < wheels.length; i++) {
          const a = wheelStates[i * 2];
          const c = wheelStates[i * 2 + 1];
          if (!a || !c) continue;
          const g = wheels[i];
          g.position.set(0, (a.y+c.y)/2 + (i===0 ? .35 : .33)-WHEEL_RADIUS, (a.z+c.z)/2 * visualAxle/HALF_WHEELBASE);
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
          g.position.set(s.x * (isUTV ? .82/HALF_TRACK : 1), s.y + (isUTV ? -.02 : 0), s.z * visualAxle/HALF_WHEELBASE);
          g.rotation.y = s.steer;
          (g.userData.spin as THREE.Group).rotation.x = s.spin;
        }
      }
      updateLinks();
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
      if (rearWheelGeos !== wheelGeos) { rearWheelGeos.tyre.dispose(); rearWheelGeos.rim.dispose(); }
      axleGeo.dispose();linkGeo.dispose();coilGeo.dispose();
      for (const m of Object.values(materials)) m.dispose();
    },
  };
}

// --- shared bodywork ----------------------------------------------------------


function buildFront(b: PartBuilder, noseZ: number, width = 1.94) {
  // Grille: a dark recess with slats catching a little light across it.
  b.add(box(0.98, 0.3, 0.07), 'rubber', [0, 0.03, noseZ + 0.015]);
  for (let i = 0; i < 3; i++) {
    b.add(box(0.92, 0.03, 0.04), 'trim', [0, -0.07 + i * 0.1, noseZ + 0.045]);
  }

  // Headlamps sit in dark surrounds outboard of the grille, indicators beyond.
  b.addPair(() => box(0.3, 0.24, 0.05), 'trim', [0.66, 0.04, noseZ + 0.015]);
  b.addPair(() => box(0.24, 0.17, 0.05), 'lamp', [0.66, 0.04, noseZ + 0.04]);
  b.addPair(() => box(0.1, 0.13, 0.05), 'amber', [0.86, 0.03, noseZ + 0.03]);

  for (const side of [-1, 1]) {
    const reflector = new THREE.TorusGeometry(0.061, 0.009, 8, 24);
    b.add(reflector, 'chrome', [side * 0.66, 0.04, noseZ + 0.069]);
    for (let i = -3; i <= 3; i++) b.add(box(0.006, 0.14, 0.004), 'chrome', [side * 0.66 + i * 0.026, 0.04, noseZ + 0.068]);
  }
  for (let x = -0.42; x <= 0.42; x += 0.07) b.add(box(0.012, 0.28, 0.012), 'steel', [x, 0.03, noseZ + 0.054]);
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
        const g = new THREE.TorusGeometry(0.58, 0.085, 8, 32, Math.PI);
        g.rotateY(Math.PI / 2);
        return g;
      },
      'trim',
      [BODY_HALF_W - 0.03, hubY, z],
    );
    // Fills the corner between arch and body so there's no gap at the top.

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
 * Rounded station corners and creased normals produce narrow continuous
 * highlights while keeping the large stamped panels flat.
 */
function loft(stations: Station[], capFront = true, capBack = true): THREE.BufferGeometry {
  const rings = stations.map((s) => {
    const c = Math.max(0.002, Math.min(s.c ?? 0.012, s.hw * 0.4, (s.y1 - s.y0) * 0.4));
    const x = s.x ?? 0;
    const ring: [number, number, number][] = [];
    const corners = [
      [s.hw - c, s.y1 - c], [-s.hw + c, s.y1 - c],
      [-s.hw + c, s.y0 + c], [s.hw - c, s.y0 + c],
    ];
    for (let corner = 0; corner < 4; corner++) {
      for (let i = 0; i <= 4; i++) {
        const angle = (corner + i / 4) * Math.PI / 2;
        ring.push([x + corners[corner][0] + Math.cos(angle) * c,
          corners[corner][1] + Math.sin(angle) * c, s.z]);
      }
    }
    return ring;
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
  return toCreasedNormals(geo, Math.PI / 3);
}

/** A lofted volume added straight to the builder, at the origin. */
function shell(b: PartBuilder, key: MatKey, stations: Station[], capFront = true, capBack = true) {
  if (key === 'body' && stations.every(s => s.y0 >= 0.35)) {
    // Build an actual hollow cabin. Glass frames open onto seats and dashboard.
    b.add(loft(stations.map(s => ({ ...s, y0: s.y1 - 0.075 }))), 'body', [0, 0, 0]);
    const first = stations[0], last = stations[stations.length - 1];
    const middle = (first.z + last.z) / 2;
    const width = Math.max(...stations.map(s => s.hw));
    const floor = first.y0;
    for (const side of [-1, 1]) {
      b.add(box(0.06, 0.16, last.z - first.z), 'body', [side * width, floor + 0.075, middle]);
      b.add(box(0.06, 0.11, last.z - first.z), 'body', [side * width, last.y1 - 0.075, middle]);
      b.add(box(0.024, last.y1 - floor - 0.1, last.z - first.z - 0.08), 'glass', [side * (width - 0.018), (floor + last.y1) / 2, middle]);
      for (const station of [first, last]) {
        b.add(box(0.085, station.y1 - floor, 0.09), 'body', [side * (station.hw - 0.02), (floor + station.y1) / 2, station.z]);
      }
    }
    b.add(box(width * 1.9, last.y1 - floor - 0.09, 0.024), 'glass', [0, (floor + first.y1) / 2, first.z + 0.01]);
    b.add(box(width * 1.8, 0.18, 0.32), 'trim', [0, floor - 0.02, last.z - 0.19]);
    b.add(box(width * 1.8, 0.08, last.z - first.z), 'trim', [0, floor - 0.34, middle]);
    for (const x of [-0.43, 0.43]) {
      const seatZ = last.z - 0.72;
      b.add(box(0.57, 0.12, 0.52), 'trim', [x, floor - 0.17, seatZ]);
      b.add(box(0.56, 0.58, 0.16), 'trim', [x, floor + 0.09, seatZ - 0.23], [-0.12, 0, 0]);
      b.add(box(0.26, 0.18, 0.12), 'trim', [x, floor + 0.49, seatZ - 0.26]);
      for (const z of [-0.1, 0.1]) b.add(box(0.008, 0.45, 0.008), 'bodyDark', [x + z, floor + 0.09, seatZ - 0.135]);
    }
    const steering = new THREE.TorusGeometry(0.18, 0.022, 8, 32);
    b.add(steering, 'rubber', [0.43, floor + 0.13, last.z - 0.40], [-0.4, 0, 0]);
    b.strut('trim', [0.43, floor - 0.1, last.z - 0.18], [0.43, floor + 0.13, last.z - 0.4], 0.035);
    return;
  }
  if (key === 'body' && stations.every(s => s.y0 < 0)) {
    const refined: Station[] = [];
    for (let i = 0; i < stations.length - 1; i++) {
      const a = stations[i], c = stations[i + 1];
      const n = Math.max(1, Math.ceil((c.z - a.z) / 0.085));
      for (let j = 0; j < n; j++) {
        const t = j / n;
        const station = { z: THREE.MathUtils.lerp(a.z, c.z, t), hw: THREE.MathUtils.lerp(a.hw, c.hw, t), y0: THREE.MathUtils.lerp(a.y0, c.y0, t), y1: THREE.MathUtils.lerp(a.y1, c.y1, t), c: THREE.MathUtils.lerp(a.c ?? 0.04, c.c ?? 0.04, t) };
        const d = Math.min(Math.abs(station.z - HALF_WHEELBASE), Math.abs(station.z + HALF_WHEELBASE));
        if (d < 0.57) station.y0 = Math.min(station.y1 - 0.09, Math.max(station.y0, AXLE_HEIGHT - 0.4 + Math.sqrt(0.57 ** 2 - d ** 2)));
        refined.push(station);
      }
    }
    refined.push(stations[stations.length - 1]);
    b.add(loft(refined, capFront, capBack), key, [0, 0, 0]);
    return;
  }
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
  b.add(box(1.22, 0.016, 0.018), 'trim', [0, 0.77, -2.057]);
  b.add(box(0.42, 0.025, 0.025), 'trim', [-0.16, 0.78, -2.07], [0, 0, -0.12]);
  b.add(box(0.20, 0.036, 0.035), 'chrome', [0.45, 0.49, -2.06]);
  b.add(box(0.30, 0.11, 0.025), 'trim', [0, -0.26, -2.10]);
  b.add(box(0.24, 0.073, 0.027), 'lamp', [0, -0.26, -2.115]);
  for (const x of [-0.62, 0.62]) {
    b.add(box(0.035, 0.045, 2.1), 'trim', [x, 1.32, -0.5]);
    b.add(box(0.10, 0.055, 0.20), 'bodyDark', [x, 1.30, -1.45]);
    b.add(box(0.10, 0.055, 0.20), 'bodyDark', [x, 1.30, 0.45]);
  }
  b.strut('steel', [-0.58, -0.51, -2.13], [-0.58, -0.60, -2.30], 0.065);

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
/** A narrow enduro bike: 1.50 m wheelbase, long forks and high mudguards. */
function buildMoto(b: PartBuilder) {
  const head: [number,number,number] = [0,.03,.48];
  for (const side of [-1,1]) {
    const x=side*.105;
    b.strut('steel',[x,.11,.46],[x,-.44,.68],.026);

    b.add(box(.085,.27,.085),'body',[x,-.49,.70],[-.22,0,0]);

    b.strut('trim',head,[side*.12,-.35,.10],.022);
    b.strut('trim',[side*.12,-.35,.10],[side*.12,-.68,.02],.023);
    b.strut('trim',[side*.12,-.68,.02],[side*.12,-.58,-.22],.023);
    b.strut('trim',[side*.12,-.58,-.22],head,.023);
    b.strut('steel',[side*.12,-.49,-.13],[side*.10,-.15,-.66],.018);
    b.add(box(.13,.025,.065),'steel',[side*.19,-.57,-.12]);
  }
  // Cast crankcase, cylinder and cooling fins, framed by the cradle.
  const casing=new THREE.CylinderGeometry(.13,.13,.23,32); casing.rotateZ(Math.PI/2);
  b.add(casing,'steel',[0,-.53,.02]);
  b.add(box(.18,.19,.17),'trim',[0,-.33,.10],[-.17,0,0]);
  for(let i=0;i<8;i++) b.add(box(.205,.009,.19),'steel',[0,-.42+i*.019,.10],[-.17,0,0]);
  b.add(box(.18,.055,.17),'steel',[0,-.23,.08]);
  b.add(box(.25,.024,.30),'steel',[0,-.70,.035],[.10,0,0]);
  for(const x of [-.12,.12]) for(let i=0;i<6;i++) {
    const a=i*Math.PI/3;
    const bolt=new THREE.CylinderGeometry(.009,.009,.015,6); bolt.rotateZ(Math.PI/2);
    b.add(bolt,'chrome',[x,-.53+Math.sin(a)*.095,.02+Math.cos(a)*.095]);
  }
  b.add(springBetween(new THREE.Vector3(0,-.18,-.22),new THREE.Vector3(0,-.61,-.40),.036),'amber',[0,0,0]);
  // Tank and radiator shrouds taper into the saddle, rather than a car-sized tank.
  b.add(loft([{z:-.16,hw:.105,y0:-.27,y1:-.12,c:.035},{z:.12,hw:.155,y0:-.38,y1:-.08,c:.04},{z:.36,hw:.12,y0:-.28,y1:-.11,c:.035}]),'body',[0,0,0]);
  b.add(loft([{z:-.71,hw:.075,y0:-.19,y1:-.12,c:.02},{z:-.43,hw:.115,y0:-.22,y1:-.135,c:.03},{z:.10,hw:.105,y0:-.16,y1:-.09,c:.03}]),'rubber',[0,0,0]);
  b.add(tube(.025,.029),'trim',[0,-.065,.21]);
  for(const side of [-1,1]) {
    b.add(box(.045,.22,.30),'body',[side*.16,-.25,.20],[.25,0,side*.16]);
    b.add(box(.014,.14,.21),'trim',[side*.183,-.29,.20],[.25,0,side*.16]);
    for(let i=0;i<5;i++) b.add(box(.02,.009,.19),'steel',[side*.195,-.35+i*.025,.20]);
    b.add(box(.025,.18,.31),'body',[side*.135,-.26,-.48],[.23,0,0]);
  }
  // Swept, thin plastic mudguards.
  b.add(loft([{z:.42,hw:.09,y0:-.25,y1:-.22,c:.025},{z:.72,hw:.11,y0:-.24,y1:-.20,c:.025},{z:1.05,hw:.066,y0:-.20,y1:-.175,c:.015}]),'body',[0,0,0]);
  b.add(loft([{z:-1.0,hw:.06,y0:-.19,y1:-.16,c:.015},{z:-.69,hw:.12,y0:-.21,y1:-.17,c:.025},{z:-.40,hw:.11,y0:-.24,y1:-.20,c:.025}]),'body',[0,0,0]);
  b.add(box(.24,.23,.038),'body',[0,-.02,.56],[-.22,0,0]);
  b.add(box(.16,.10,.024),'lamp',[0,-.035,.585],[-.22,0,0]);
  for(const y of [-.04,.06]) b.add(box(.27,.025,.08),'steel',[0,y,.48]);
  const bars=new THREE.CatmullRomCurve3([new THREE.Vector3(-.39,.17,.40),new THREE.Vector3(-.20,.16,.47),new THREE.Vector3(-.09,.10,.47),new THREE.Vector3(.09,.10,.47),new THREE.Vector3(.20,.16,.47),new THREE.Vector3(.39,.17,.40)]);
  b.add(new THREE.TubeGeometry(bars,32,.012,10,false),'steel',[0,0,0]);
  for(const side of [-1,1]) {
    b.strut('rubber',[side*.27,.17,.426],[side*.39,.17,.40],.021);
    b.strut('chrome',[side*.26,.17,.43],[side*.36,.16,.49],.007);
    b.add(box(.16,.055,.035),'body',[side*.32,.17,.51]);
  }
  const exhaust=new THREE.CatmullRomCurve3([new THREE.Vector3(.10,-.29,.16),new THREE.Vector3(.19,-.39,.31),new THREE.Vector3(.22,-.48,.18),new THREE.Vector3(.22,-.35,-.17),new THREE.Vector3(.20,-.27,-.51)]);
  b.add(new THREE.TubeGeometry(exhaust,40,.022,12,false),'chrome',[0,0,0]);
  b.strut('steel',[.20,-.28,-.42],[.20,-.23,-.78],.058);
  b.strut('rubber',[.20,-.23,-.76],[.20,-.225,-.80],.033);
  for(const y of [-.51,-.71]) b.strut('trim',[-.145,y,-.10],[-.145,y-.03,-.75],.008);
}

/** Two-seat sport UTV, with a roof canopy, half doors and an enclosed rear engine. */
function buildBuggy(b: PartBuilder) {
  b.add(loft([{z:-1.40,hw:.54,y0:-.55,y1:-.18,c:.06},{z:-.77,hw:.70,y0:-.63,y1:-.18,c:.05},{z:.55,hw:.64,y0:-.62,y1:-.22,c:.05},{z:1.40,hw:.52,y0:-.45,y1:-.20,c:.05}]),'trim',[0,0,0]);
  // Angular bonnet and high front fender shoulders.
  b.add(loft([{z:.55,hw:.63,y0:-.30,y1:.17,c:.08},{z:1.0,hw:.67,y0:-.33,y1:.10,c:.06},{z:1.50,hw:.46,y0:-.33,y1:-.06,c:.05}]),'body',[0,0,0]);
  b.add(loft([{z:.57,hw:.28,y0:.14,y1:.185,c:.025},{z:1.1,hw:.30,y0:.065,y1:.11,c:.025},{z:1.43,hw:.20,y0:-.065,y1:-.04,c:.02}]),'trim',[0,0,0]);
  for(const side of [-1,1]) {
    b.add(loft([{z:.69,hw:.19,y0:-.03,y1:.10,c:.04},{z:1.05,hw:.23,y0:-.015,y1:.09,c:.04},{z:1.42,hw:.17,y0:-.15,y1:-.065,c:.04}]),'body',[side*.62,0,0]);
    b.add(box(.31,.075,.065),'lamp',[side*.40,-.14,1.535],[0,side*-.18,side*.16]);
    b.add(box(.34,.025,.025),'chrome',[side*.40,-.105,1.57],[0,side*-.18,side*.16]);
    b.strut('trim',[side*.61,-.52,-.76],[side*.63,-.52,.61],.045);
    // Faceted half doors; raised front lip and recessed handle.
    const door=new THREE.Shape(); door.moveTo(-.71,-.40);door.lineTo(-.63,.10);door.lineTo(-.19,.06);door.lineTo(.57,.22);door.lineTo(.60,-.40);door.closePath();
    const panel=new THREE.ExtrudeGeometry(door,{depth:.035,bevelEnabled:true,bevelSize:.014,bevelThickness:.01,bevelSegments:2,steps:1});
    panel.rotateY(Math.PI/2); b.add(panel,'body',[side*.65,0,0]);
    b.add(box(.027,.055,.16),'trim',[side*.696,.015,-.45]);
    b.strut('trim',[side*.68,-.27,-.58],[side*.68,-.32,.43],.018);
    // Cage A/B pillars and rear stays meet at explicit joints.
    b.strut('trim',[side*.64,-.42,.62],[side*.57,.86,.38],.037);
    b.strut('trim',[side*.63,-.46,-.66],[side*.59,.88,-.65],.040);
    b.strut('trim',[side*.59,.88,-.65],[side*.57,.86,.38],.037);
    b.strut('trim',[side*.59,.86,-.65],[side*.58,-.20,-1.38],.036);
    b.add(box(.15,.16,.085),'trim',[side*.73,.30,.52]);
    b.add(box(.13,.13,.012),'glass',[side*.73,.30,.465]);
  }
  b.strut('trim',[-.57,.86,.38],[.57,.86,.38],.038);
  b.add(rollHoop(.59,-.45,.88,-.65,.038),'trim',[0,0,0]);
  b.add(loft([{z:-.77,hw:.65,y0:.88,y1:.93,c:.06},{z:.45,hw:.63,y0:.86,y1:.91,c:.055}]),'trim',[0,0,0]);
  b.strut('trim',[-.59,-.32,-.65],[.59,.84,-.65],.025);
  b.add(box(1.15,.14,.24),'trim',[0,.09,.45]);
  b.add(box(.19,.085,.018),'glass',[.32,.15,.315],[-.15,0,0]);
  b.add(steeringWheel(.155),'rubber',[.32,.14,.22],[-.36,0,0]);
  b.strut('steel',[.32,.10,.40],[.32,.14,.22],.02);
  for(const x of [-.32,.32]) {
    b.add(bucketSeat(),'trim',[x,-.36,-.45]);
    b.add(box(.42,.12,.45),'rubber',[x,-.38,-.24]);
    for(const dx of [-.08,.08]) b.strut('rubber',[x+dx,.16,-.46],[x+dx,-.35,-.07],.015);
  }
  b.add(box(.18,.24,.53),'trim',[0,-.32,-.17]);
  b.strut('steel',[0,-.24,.06],[0,-.06,.10],.013);
  b.add(new THREE.SphereGeometry(.027,12,8),'rubber',[0,-.06,.10]);
  // Rear engine cover/cargo tray, no sand-rail wing or exposed flat-four.
  b.add(box(1.24,.12,.67),'body',[0,-.01,-1.03]);
  for(const x of [-.61,.61]) b.add(box(.05,.15,.65),'trim',[x,.05,-1.03]);
  b.add(box(1.22,.15,.045),'trim',[0,.05,-1.36]);
  for(let i=0;i<9;i++) b.add(box(.70,.014,.025),'trim',[0,.057,-1.27+i*.055]);
  for(const side of [-1,1]) b.add(box(.26,.07,.035),'brake',[side*.44,-.07,-1.405]);
  b.strut('steel',[-.48,-.42,-1.47],[.48,-.42,-1.47],.034);
  b.add(box(.57,.21,.04),'rubber',[0,-.205,1.525]);
  for(let i=0;i<5;i++) b.add(box(.49,.012,.02),'trim',[0,-.28+i*.036,1.55]);
  b.strut('steel',[-.43,-.38,1.57],[.43,-.38,1.57],.035);

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
    b.addPair(() => box(0.022, y1 - y0, each), 'glass', [x, (y0 + y1) / 2, z]);
    for (const yy of [y0 - 0.012, y1 + 0.012]) b.addPair(() => box(0.04, 0.025, each + 0.05), 'rubber', [x + 0.009, yy, z]);
    for (const zz of [z - each / 2 - 0.015, z + each / 2 + 0.015]) b.addPair(() => box(0.065, y1 - y0 + 0.06, 0.06), 'body', [x, (y0 + y1) / 2, zz]);
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
  b.add(box(halfW * 2 + 0.14, 0.1, 0.12), 'body', [0, y1 + 0.05, z - 0.13]);
  b.add(box(halfW * 2, 0.07, 0.08), 'rubber', [0, y0 + 0.015, z + 0.075]);
  for (const side of [-1, 1]) {
    b.strut('trim', [side * 0.35, y0 + 0.04, z + 0.09], [side * 0.55, y0 + 0.15, z + 0.07], 0.009);
    b.add(box(0.42, 0.018, 0.018), 'rubber', [side * 0.44, y0 + 0.15, z + 0.075], [0, 0, side * 0.07]);
  }
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
  moto: { build: buildMoto, twoWheeled: true, wheelWidth: 0.42 },
  buggy: { build: buildBuggy },
};

function buildWheelGeometry(
  style: WheelStyleId,
): { tyre: THREE.BufferGeometry; rim: THREE.BufferGeometry } {
  const tyreParts: THREE.BufferGeometry[] = [];
  const rimParts: THREE.BufferGeometry[] = [];

  const tread = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, WHEEL_WIDTH, 48);
  tread.rotateZ(Math.PI / 2);
  tyreParts.push(tread);
  for (let side = -1; side <= 1; side += 2) {
    const sidewall = new THREE.TorusGeometry(WHEEL_RADIUS - 0.065, 0.065, 8, 48);
    sidewall.rotateY(Math.PI / 2);
    sidewall.translate(side * (WHEEL_WIDTH / 2 - 0.035), 0, 0);
    tyreParts.push(sidewall);
  }
  for (let i = 0; i < 36; i++) {
    const angle = i / 36 * Math.PI * 2;
    for (let row = -1; row <= 1; row++) {
      const block = new THREE.BoxGeometry(WHEEL_WIDTH * 0.28, 0.028, 0.055);
      block.rotateY(row * 0.28);
      block.translate(row * WHEEL_WIDTH * 0.30, WHEEL_RADIUS, 0);
      block.rotateX(angle + (row % 2) * 0.06);
      tyreParts.push(block);
    }
  }


  const along = (radius: number, width: number, segments: number) => {
    const g = new THREE.CylinderGeometry(radius, radius, width, Math.max(segments, 32));
    g.rotateZ(Math.PI / 2);
    return g;
  };
  const rimRadius = style === 'alloy' ? 0.285 : 0.245;
  const barrel = new THREE.CylinderGeometry(rimRadius, rimRadius, WHEEL_WIDTH, 48, 1, true);
  barrel.rotateZ(Math.PI / 2);
  rimParts.push(barrel);
  for (const side of [-1, 1]) {
    const faceX = side * (WHEEL_WIDTH / 2 + 0.008);
    const lip = new THREE.TorusGeometry(rimRadius, 0.018, 8, 48);
    lip.rotateY(Math.PI / 2); lip.translate(faceX, 0, 0); rimParts.push(lip);
    const rotor = along(rimRadius * 0.77, 0.014, 48);
    rotor.translate(faceX - side * 0.065, 0, 0); rimParts.push(rotor);
    const hub = along(0.072, 0.055, 32); hub.translate(faceX, 0, 0); rimParts.push(hub);
    const spokes = style === 'alloy' ? 6 : 8;
    for (let i = 0; i < spokes; i++) {
      const a = i / spokes * Math.PI * 2;
      const spoke = box(0.025, rimRadius - 0.045, style === 'alloy' ? 0.036 : 0.062);
      spoke.translate(faceX, rimRadius / 2 + 0.023, 0); spoke.rotateX(a); rimParts.push(spoke);
    }
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2;
      const lug = along(0.013, 0.024, 6); lug.translate(faceX + side * 0.029, Math.cos(a) * 0.057, Math.sin(a) * 0.057); rimParts.push(lug);
    }
    if (style === 'beadlock') for (let i = 0; i < 20; i++) {
      const a = i / 20 * Math.PI * 2;
      const bolt = along(0.012, 0.023, 6); bolt.translate(faceX + side * 0.016, Math.cos(a) * rimRadius, Math.sin(a) * rimRadius); rimParts.push(bolt);
    }
    for (const radius of [0.31, 0.335]) {
      const ring = new THREE.TorusGeometry(radius, 0.0035, 4, 48);
      ring.rotateY(Math.PI / 2); ring.translate(side * WHEEL_WIDTH / 2, 0, 0); tyreParts.push(ring);
    }
  }

  for (const parts of [tyreParts, rimParts]) for (let i = 0; i < parts.length; i++) {
    if (parts[i].index) { const old = parts[i]; parts[i] = old.toNonIndexed(); old.dispose(); }
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

/** Wire-spoked off-road wheels with separate tyre, rim, hubs and brake discs. */
function buildDirtWheel(radius: number, halfWidth: number) {
  const tyre: THREE.BufferGeometry[]=[], rim: THREE.BufferGeometry[]=[];
  const rubber=new THREE.TorusGeometry(radius-.047,.047,12,72); rubber.rotateY(Math.PI/2); rubber.scale(halfWidth/.047,1,1); tyre.push(rubber);
  for(let i=0;i<44;i++) for(let row=-1;row<=1;row++) {
    const a=(i+(row%2)*.45)/44*Math.PI*2;
    const block=box(halfWidth*.62,.022,.032); block.translate(row*halfWidth*.59,radius-.009,0);block.rotateX(a);tyre.push(block);
  }
  const rimRadius=radius-.085;
  for(const side of [-1,1]) {
    const hoop=new THREE.TorusGeometry(rimRadius,.009,8,64);hoop.rotateY(Math.PI/2);hoop.translate(side*halfWidth*.52,0,0);rim.push(hoop);
    for(let i=0;i<18;i++) {
      const a=i/18*Math.PI*2, offset=side*.19;
      const from=new THREE.Vector3(side*.04,Math.cos(a+offset)*.047,Math.sin(a+offset)*.047);
      const to=new THREE.Vector3(side*halfWidth*.48,Math.cos(a)*rimRadius,Math.sin(a)*rimRadius);
      const direction=to.clone().sub(from);
      const spoke=new THREE.CylinderGeometry(.0024,.0024,direction.length(),5);spoke.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),direction.normalize()));spoke.translate(...from.add(to).multiplyScalar(.5).toArray());rim.push(spoke);
    }
  }
  const hub=new THREE.CylinderGeometry(.047,.047,.11,24);hub.rotateZ(Math.PI/2);rim.push(hub);
  const rotor=new THREE.RingGeometry(.060,.119,48);rotor.rotateY(Math.PI/2);rotor.translate(-halfWidth*.70,0,0);rim.push(rotor);
  const reverse=rotor.clone();reverse.rotateY(Math.PI);rim.push(reverse);
  const merge=(parts: THREE.BufferGeometry[])=>{
    const flat=parts.map(p=>{const g=p.index?p.toNonIndexed():p;for(const key of Object.keys(g.attributes))if(!['position','normal'].includes(key))g.deleteAttribute(key);return g;});
    const geo=mergeGeometries(flat)!;new Set([...parts,...flat]).forEach(g=>g.dispose());return geo;
  };
  return {tyre:merge(tyre),rim:merge(rim)};
}
