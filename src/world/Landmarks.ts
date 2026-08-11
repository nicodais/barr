import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type RAPIER from '@dimforge/rapier3d-compat';
import { POIS, type Poi, type PoiKind } from '../data/pois';
import { heightAt } from '../terrain/height';

/**
 * The physical landmarks at each POI (§5). Flat-shaded primitives in the same
 * limited palette as the terrain — silhouettes on a ridge, dressed with enough
 * tonal variation and grounding that they read as placed in the sand rather than
 * dropped on a flat plane.
 *
 * Each also gets a set of static colliders (see `createLandmarkColliders`) sized
 * to its solid masses — the tower, the trunk, the pylon legs — so the truck bumps
 * them instead of driving through. There's still no damage model (§11): a
 * collision is tactile, never a fail state, and small dressing (cups, stakes,
 * canopy) stays collider-free so nothing snags on an invisible box.
 */
const STONE = new THREE.MeshLambertMaterial({ color: 0x9c8b76, flatShading: true });
const STONE_LIGHT = new THREE.MeshLambertMaterial({ color: 0xb3a189, flatShading: true });
const DARK_STONE = new THREE.MeshLambertMaterial({ color: 0x7d6e5c, flatShading: true });
const RUST = new THREE.MeshLambertMaterial({ color: 0x8c5a3c, flatShading: true });
const RUST_DARK = new THREE.MeshLambertMaterial({ color: 0x6d4126, flatShading: true });
const WOOD = new THREE.MeshLambertMaterial({ color: 0x6f5439, flatShading: true });
const WOOD_DARK = new THREE.MeshLambertMaterial({ color: 0x554027, flatShading: true });
const FOLIAGE = new THREE.MeshLambertMaterial({ color: 0x6b7f4a, flatShading: true });
const FOLIAGE_DARK = new THREE.MeshLambertMaterial({ color: 0x566b3c, flatShading: true });
const CANVAS = new THREE.MeshLambertMaterial({ color: 0xc4b49a, flatShading: true });
const METAL = new THREE.MeshLambertMaterial({ color: 0xa9a49b, flatShading: true });

export function createLandmarks(): THREE.Group {
  const group = new THREE.Group();
  for (const poi of POIS) {
    const built = buildLandmark(poi);
    const baseY = heightAt(poi.x, poi.z);
    built.position.set(poi.x, baseY, poi.z);
    drapeToTerrain(built, poi.x, poi.z, baseY);
    group.add(bake(built));
  }
  return group;
}

/**
 * Bakes a built landmark down to one mesh per material. The builders stay
 * authored as dozens of readable primitives, but ~350 individual meshes across
 * ten POIs blow the ~150 draw-call budget (§8) on their own — merged, the whole
 * set costs a few draws per landmark, and each merged mesh still frustum-culls
 * as a unit via its own bounding sphere. Same trick the truck uses.
 */
function bake(built: THREE.Group): THREE.Group {
  built.updateMatrixWorld(true);
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  built.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    // World transform baked into the vertices; the baked group sits at identity.
    const cloned = (obj.geometry as THREE.BufferGeometry).clone().applyMatrix4(obj.matrixWorld);
    // mergeGeometries returns null for a bucket mixing indexed (box, cylinder)
    // and non-indexed (icosahedron, dodecahedron) geometry — which silently
    // deleted every piece sharing that material. Normalise to non-indexed so
    // any primitive can share a bucket.
    const geo = cloned.index ? cloned.toNonIndexed() : cloned;
    if (geo !== cloned) cloned.dispose();
    const mat = obj.material as THREE.Material;
    let list = buckets.get(mat);
    if (!list) buckets.set(mat, list = []);
    list.push(geo);
  });

  const baked = new THREE.Group();
  for (const [mat, geos] of buckets) {
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!merged) {
      console.warn('[dune] landmark bake dropped a material bucket');
      continue;
    }
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    baked.add(mesh);
  }
  return baked;
}

/**
 * Settles each piece of a landmark onto the terrain at its own footprint. Every
 * mesh is authored with local Y measured from ground = 0, so shifting it by the
 * terrain delta at its world position lets extended props — the camel track, the
 * falaj — follow the dunes instead of floating at the centre's single height.
 */
function drapeToTerrain(built: THREE.Group, ox: number, oz: number, baseY: number): void {
  const ry = built.rotation.y;
  const c = Math.cos(ry);
  const s = Math.sin(ry);
  for (const child of built.children) {
    const lx = child.position.x;
    const lz = child.position.z;
    const wx = ox + lx * c + lz * s;
    const wz = oz - lx * s + lz * c;
    child.position.y += heightAt(wx, wz) - baseY;
  }
}

function buildLandmark(poi: Poi): THREE.Group {
  switch (poi.id) {
    case 'falaj': return buildFalaj();
    case 'ghaf': return buildGhafTree();
    case 'watchtower': return buildWatchtower();
    case 'majlis': return buildMajlis();
    case 'pylons': return buildPylons();
    case 'teastand': return buildTeaStand();
    case 'famousdune': return buildFamousDune();
    case 'falconry': return buildFalconry();
    case 'cameltrack': return buildCamelTrack();
    case 'coffeehearth': return buildCoffeeHearth();
  }
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** A stretch of ancient irrigation channel, half-buried and going nowhere. */
function buildFalaj(): THREE.Group {
  const g = new THREE.Group();
  const slab = new THREE.BoxGeometry(1.5, 0.75, 0.5);
  // The channel runs at an angle and sinks into the sand at both ends, so it
  // reads as something the desert is in the middle of swallowing.
  for (let i = -7; i <= 7; i++) {
    const t = i / 7;
    const sink = t * t * 0.75;
    const x = i * 1.55;
    const z = Math.sin(i * 0.4) * 0.8;
    for (const side of [-0.75, 0.75]) {
      const block = mesh(slab, i % 3 === 0 ? DARK_STONE : STONE, x, 0.35 - sink, z + side);
      block.rotation.y = 0.3 + Math.sin(i * 1.7) * 0.12;
      block.rotation.z = Math.sin(i * 2.3) * 0.06;
      g.add(block);
    }
  }
  g.rotation.y = 0.5;
  return g;
}

/** One improbably old ghaf, the only shade for kilometres. */
function buildGhafTree(): THREE.Group {
  const g = new THREE.Group();
  const trunk = mesh(new THREE.CylinderGeometry(0.32, 0.62, 3.4, 7), WOOD, 0, 1.7, 0);
  trunk.rotation.z = 0.07;
  g.add(trunk);

  // Root flare where the trunk meets the sand, so it grips rather than pokes in.
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const root = mesh(new THREE.CylinderGeometry(0.08, 0.24, 0.9, 5), WOOD_DARK,
      Math.cos(a) * 0.5, 0.18, Math.sin(a) * 0.5);
    root.rotation.z = Math.cos(a) * 0.9;
    root.rotation.x = -Math.sin(a) * 0.9;
    g.add(root);
  }

  // Canopy is a cluster of low-poly blobs — wide and flat, the way a ghaf grows.
  // Two greens layered so it reads as sunlit crown over shaded underside.
  const blob = new THREE.IcosahedronGeometry(1, 0);
  const canopy: Array<[number, number, number, number, THREE.Material]> = [
    [0, 3.95, 0, 2.6, FOLIAGE], [1.7, 3.5, 0.5, 1.8, FOLIAGE],
    [-1.6, 3.6, -0.6, 1.9, FOLIAGE], [0.4, 3.2, -1.7, 1.6, FOLIAGE_DARK],
    [-0.6, 3.3, 1.6, 1.5, FOLIAGE_DARK], [0.9, 2.95, 1.2, 1.3, FOLIAGE_DARK],
  ];
  for (const [x, y, z, s, mat] of canopy) {
    const m = mesh(blob, mat, x, y, z);
    m.scale.set(s, s * 0.6, s);
    m.rotation.y = Math.random() * Math.PI;
    g.add(m);
  }

  for (let i = 0; i < 3; i++) {
    const branch = mesh(new THREE.CylinderGeometry(0.1, 0.16, 2.2, 5), WOOD,
      Math.cos(i * 2.1) * 0.9, 3.0, Math.sin(i * 2.1) * 0.9);
    branch.rotation.z = Math.cos(i * 2.1) * 0.6;
    branch.rotation.x = Math.sin(i * 2.1) * 0.6;
    g.add(branch);
  }
  return g;
}

/** Crumbling stone tower on an outcrop; once watched for raiders. */
function buildWatchtower(): THREE.Group {
  const g = new THREE.Group();
  // Rocky base so it sits on something other than sand.
  for (let i = 0; i < 6; i++) {
    const rock = mesh(new THREE.DodecahedronGeometry(2.2 + (i % 3) * 0.4, 0),
      i % 2 ? DARK_STONE : STONE, Math.cos(i * 1.05) * 3.3, -0.6, Math.sin(i * 1.05) * 3.3);
    rock.scale.set(1, 0.55, 1);
    rock.rotation.y = i;
    g.add(rock);
  }
  // Tower built in courses stacked flush — each course's floor sits exactly on
  // the previous one's ceiling — alternating tone so it reads as stacked stone,
  // and each course rotated a little so the facets don't line up.
  const courses: Array<[number, number, number]> = [
    // [bottomRadius, topRadius, height]
    [3.1, 2.85, 2.0],
    [2.85, 2.6, 1.9],
    [2.6, 2.4, 1.8],
    [2.4, 2.2, 1.6],
  ];
  let base = 0;
  for (let i = 0; i < courses.length; i++) {
    const [rb, rt, h] = courses[i];
    const course = mesh(new THREE.CylinderGeometry(rt, rb, h, 9),
      i % 2 ? STONE : STONE_LIGHT, 0, base + h / 2, 0);
    course.rotation.y = i * 0.35;
    g.add(course);
    base += h;
  }
  // Broken crown: a partial ring of merlons, most of them missing.
  for (let i = 0; i < 9; i++) {
    if (i % 3 === 1) continue;
    const a = (i / 9) * Math.PI * 2;
    const h = 0.75 + (i % 2) * 0.35;
    g.add(mesh(new THREE.BoxGeometry(0.7, h, 0.7), i % 2 ? STONE : STONE_LIGHT,
      Math.cos(a) * 1.95, base + h / 2, Math.sin(a) * 1.95));
  }
  // Dark doorway with a weathered wooden lintel over it, at ground level.
  g.add(mesh(new THREE.BoxGeometry(1.1, 1.7, 0.4), WOOD_DARK, 0, 0.85, 2.9));
  g.add(mesh(new THREE.BoxGeometry(1.35, 0.24, 0.5), WOOD, 0, 1.8, 2.92));
  return g;
}

/**
 * An open-air majlis: the flattened council ground where a ruler once held
 * court in the sand, edged with low seating, a coffee hearth at its heart and a
 * lone banner pole. No walls — that was the whole point.
 */
function buildMajlis(): THREE.Group {
  const g = new THREE.Group();

  // Packed-earth council floor, a shade darker than the sand around it.
  g.add(mesh(new THREE.CylinderGeometry(4.6, 4.7, 0.14, 20), DARK_STONE, 0, 0.07, 0));

  // A ring of low seat blocks — where people sat to be heard.
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const seat = mesh(new THREE.BoxGeometry(0.85, 0.34, 0.55), i % 2 ? WOOD : STONE,
      Math.cos(a) * 3.7, 0.17, Math.sin(a) * 3.7);
    seat.rotation.y = a;
    g.add(seat);
  }

  // Coffee hearth at the centre: a stone ring, charcoal, and a dallah pot.
  const ring = mesh(new THREE.TorusGeometry(0.62, 0.14, 6, 12), STONE, 0, 0.12, 0);
  ring.rotation.x = Math.PI / 2;
  g.add(ring);
  g.add(mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.08, 12), DARK_STONE, 0, 0.06, 0));
  g.add(dallah(0, 0));

  // The banner pole — weathered, leaning, but still standing.
  const pole = mesh(new THREE.CylinderGeometry(0.06, 0.07, 4.6, 6), WOOD, 3.4, 2.3, -3.4);
  pole.rotation.z = 0.05;
  g.add(pole);
  const banner = mesh(new THREE.BoxGeometry(1.0, 0.6, 0.05), CANVAS, 3.9, 3.9, -3.4);
  banner.rotation.z = 0.05;
  g.add(banner);
  return g;
}

/** 1970s oil-survey markers and a rusted pylon. The survey was wrong. */
function buildPylons(): THREE.Group {
  const g = new THREE.Group();
  const leg = new THREE.BoxGeometry(0.26, 11, 0.26);
  for (const [x, z] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]] as const) {
    const l = mesh(leg, RUST, x, 5.5, z);
    l.rotation.x = -z * 0.018;
    l.rotation.z = x * 0.018;
    g.add(l);
  }
  // Cross-bracing, thinning toward the top; darker where rust has taken hold.
  for (let i = 1; i <= 5; i++) {
    const y = i * 1.9;
    const w = 3.4 - i * 0.22;
    const mat = i % 2 ? RUST : RUST_DARK;
    g.add(mesh(new THREE.BoxGeometry(w, 0.16, 0.16), mat, 0, y, -1.5 + i * 0.03));
    g.add(mesh(new THREE.BoxGeometry(0.16, 0.16, w), mat, 1.5 - i * 0.03, y, 0));
    // Diagonal braces on alternating faces, to break up the ladder look.
    const diag = mesh(new THREE.BoxGeometry(0.12, 2.5, 0.12), RUST_DARK, i % 2 ? -1.5 : 1.5, y - 0.95, 0);
    diag.rotation.x = 0.62 * (i % 2 ? 1 : -1);
    g.add(diag);
  }
  g.add(mesh(new THREE.BoxGeometry(4.6, 0.2, 0.2), RUST_DARK, 0, 11.2, 0));

  // Scattered survey stakes, most of them leaning.
  for (let i = 0; i < 7; i++) {
    const a = i * 1.9;
    const d = 9 + i * 3.5;
    const stake = mesh(new THREE.BoxGeometry(0.14, 1.4, 0.14), WOOD,
      Math.cos(a) * d, 0.6, Math.sin(a) * d);
    stake.rotation.z = Math.sin(i * 3) * 0.35;
    g.add(stake);
    const flag = mesh(new THREE.BoxGeometry(0.4, 0.28, 0.04), RUST,
      Math.cos(a) * d + 0.2, 1.2, Math.sin(a) * d);
    flag.rotation.z = Math.sin(i * 3) * 0.35;
    g.add(flag);
  }
  return g;
}

/** A tiny, genuinely-in-use tea stand in the middle of nowhere. */
function buildTeaStand(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(2.6, 1.15, 1.5), WOOD, 0, 0.58, 0));
  g.add(mesh(new THREE.BoxGeometry(2.8, 0.12, 1.7), CANVAS, 0, 1.2, 0));

  // Canopy on four posts, sagging to one side.
  for (const [x, z] of [[-1.2, -0.65], [1.2, -0.65], [-1.2, 0.65], [1.2, 0.65]] as const) {
    g.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.3, 5), METAL, x, 1.15, z));
  }
  const canopy = mesh(new THREE.BoxGeometry(3.4, 0.08, 2.4), CANVAS, 0, 2.32, 0);
  canopy.rotation.z = 0.06;
  g.add(canopy);

  // A stool, a crate, and a stove — evidence someone is actually here.
  g.add(mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.45, 6), WOOD_DARK, 1.7, 0.22, 0.9));
  g.add(mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), WOOD_DARK, -1.8, 0.3, 0.7));
  g.add(mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.3, 6), METAL, 0.6, 1.3, 0));

  // A dallah on the counter and two little glasses of karak, still poured.
  g.add(dallah(-0.7, 0.1));
  for (const gx of [0.1, 0.34]) {
    g.add(mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.11, 6), CANVAS, gx, 1.21, 0.4));
  }
  // A bulb strung from the canopy — the reason it's findable at blue hour.
  g.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.5, 3), METAL, -0.4, 2.05, 0.2));
  g.add(mesh(new THREE.IcosahedronGeometry(0.09, 0), STONE_LIGHT, -0.4, 1.78, 0.2));
  return g;
}

/** An Instagram pilgrimage site, complete with abandoned tripods. */
function buildFamousDune(): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const a = i * 1.7;
    const d = 3 + i * 2.2;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    const tripod = new THREE.Group();
    for (let l = 0; l < 3; l++) {
      const la = (l / 3) * Math.PI * 2;
      const legMesh = mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.5, 4), METAL,
        Math.cos(la) * 0.28, 0.72, Math.sin(la) * 0.28);
      legMesh.rotation.z = -Math.cos(la) * 0.34;
      legMesh.rotation.x = Math.sin(la) * 0.34;
      tripod.add(legMesh);
    }
    tripod.add(mesh(new THREE.BoxGeometry(0.3, 0.2, 0.22), DARK_STONE, 0, 1.55, 0));
    tripod.position.set(x, 0, z);
    tripod.rotation.y = a;
    // One of them has fallen over and nobody came back for it.
    if (i === 2) tripod.rotation.z = Math.PI / 2.2;
    g.add(tripod);
  }
  // A discarded cup and a lens cap, because people were definitely here.
  g.add(mesh(new THREE.CylinderGeometry(0.09, 0.07, 0.16, 6), CANVAS, -1.4, 0.08, 2.1));
  g.add(mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.03, 8), DARK_STONE, 2.4, 0.02, -1.6));
  return g;
}

/** A dallah — the long-spouted Arabic coffee pot, hospitality in metal form. */
function dallah(x: number, z: number): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.15, 0.19, 0.4, 8), METAL, 0, 0.2, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.16, 8), METAL, 0, 0.48, 0));
  g.add(mesh(new THREE.ConeGeometry(0.13, 0.18, 8), METAL, 0, 0.65, 0));
  // The signature curved spout, faked with a short angled beak.
  const spout = mesh(new THREE.CylinderGeometry(0.02, 0.05, 0.34, 5), METAL, 0.17, 0.42, 0);
  spout.rotation.z = -0.7;
  g.add(spout);
  const handle = mesh(new THREE.TorusGeometry(0.1, 0.02, 5, 8), METAL, -0.16, 0.34, 0);
  handle.rotation.y = Math.PI / 2;
  g.add(handle);
  g.position.set(x, 0, z);
  return g;
}

/**
 * The falconry ground: a row of block perches (wakir) where birds were flown
 * from, one still occupied, and a training post. Al Qannas — Sheikh Zayed's
 * lifelong passion — made concrete in a few worn stands.
 */
function buildFalconry(): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const x = i * 1.5 - 3;
    const z = Math.sin(i * 1.3) * 0.5;
    g.add(mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.0, 6), WOOD, x, 0.5, z));
    // The padded top the falcon grips.
    g.add(mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.13, 10), CANVAS, x, 1.06, z));
  }

  // One bird still on its perch: a compact dark silhouette with a hooked beak.
  const body = mesh(new THREE.IcosahedronGeometry(0.17, 0), DARK_STONE, -3, 1.32, Math.sin(-1.3) * 0.5);
  body.scale.set(0.85, 1.25, 0.85);
  g.add(body);
  const beak = mesh(new THREE.ConeGeometry(0.05, 0.12, 5), RUST, -2.86, 1.34, Math.sin(-1.3) * 0.5);
  beak.rotation.z = -Math.PI / 2;
  g.add(beak);

  // A leaning training post with a lure block on the sand beside it.
  const post = mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.35, 6), WOOD, 3.6, 0.67, 1.6);
  post.rotation.z = 0.12;
  g.add(post);
  g.add(mesh(new THREE.BoxGeometry(0.4, 0.18, 0.28), WOOD, 4.3, 0.09, 2.2));
  return g;
}

/**
 * A stretch of abandoned camel-race track: two rail lines of leaning posts
 * running off into the sand, with a weathered starting gate. The Sheikhs' sport,
 * left behind when the big ovals were built.
 */
function buildCamelTrack(): THREE.Group {
  const g = new THREE.Group();
  const post = new THREE.CylinderGeometry(0.07, 0.09, 1.25, 5);
  const railLen = 3.1;
  for (let i = -11; i <= 11; i++) {
    const x = i * 3;
    for (const side of [-3.2, 3.2]) {
      const p = mesh(post, WOOD, x, 0.6, side);
      p.rotation.z = Math.sin(i * 1.7 + side) * 0.12;
      g.add(p);
      // Top rail segment between this post and the next, thinning with age.
      if (i < 11) {
        const rail = mesh(new THREE.BoxGeometry(railLen, 0.09, 0.09), WOOD, x + 1.5, 1.02, side);
        rail.rotation.z = Math.sin(i * 0.9) * 0.02;
        g.add(rail);
      }
    }
  }
  // Starting gate: two taller posts and a crossbar at one end.
  for (const side of [-3.4, 3.4]) {
    g.add(mesh(new THREE.CylinderGeometry(0.1, 0.12, 2.6, 6), RUST, -34, 1.3, side));
  }
  g.add(mesh(new THREE.BoxGeometry(0.16, 0.16, 7.2), RUST, -34, 2.5, 0));
  return g;
}

/**
 * A lone desert coffee hearth: a fire ring, a dallah left on the coals and a
 * couple of small cups. The rule out here was that gahwa was never refused —
 * ruler or lost stranger, same pot.
 */
function buildCoffeeHearth(): THREE.Group {
  const g = new THREE.Group();
  const stone = new THREE.DodecahedronGeometry(0.19, 0);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const m = mesh(stone, i % 2 ? STONE : DARK_STONE, Math.cos(a) * 0.62, 0.12, Math.sin(a) * 0.62);
    m.rotation.set(i, i * 2, i);
    g.add(m);
  }
  g.add(mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.07, 12), DARK_STONE, 0, 0.05, 0));
  g.add(dallah(0.05, 0.02));

  // A low log to sit on, and two finjan cups set out and never cleared away.
  const log = mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.1, 6), WOOD, -1.1, 0.16, 0.5);
  log.rotation.x = Math.PI / 2;
  g.add(log);
  g.add(mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.08, 6), CANVAS, -0.9, 0.04, -0.2));
  g.add(mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.08, 6), CANVAS, -0.7, 0.04, 0.05));
  return g;
}

// --- collision -------------------------------------------------------------

/**
 * A static collider, authored in the landmark's local frame. Boxes take
 * half-extents (hx, hy, hz); cylinders take half-height (hy) and radius (r).
 * `y` rotation is baked in so leaning props can still be approximated upright.
 */
interface ColliderSpec {
  kind: 'box' | 'cyl';
  x: number; y: number; z: number;
  hy: number;
  hx?: number; hz?: number; r?: number;
  rotY?: number;
}

/** Landmarks whose whole group is rotated in the scene — colliders match it. */
function groupRotationY(id: PoiKind): number {
  return id === 'falaj' ? 0.5 : 0;
}

/**
 * Builds the static colliders for every POI (§11: solid but damage-free). Sized
 * to the load-bearing masses only — towers, trunks, legs, counters, posts — so
 * the truck bumps the landmark without small dressing snagging it. Colliders are
 * standalone (no rigid body), exactly like the terrain heightfield.
 */
export function createLandmarkColliders(rapier: typeof RAPIER, world: RAPIER.World): void {
  for (const poi of POIS) {
    const gRot = groupRotationY(poi.id);
    const c = Math.cos(gRot);
    const s = Math.sin(gRot);
    for (const spec of colliderSpecs(poi.id)) {
      const desc = spec.kind === 'box'
        ? rapier.ColliderDesc.cuboid(spec.hx!, spec.hy, spec.hz!)
        : rapier.ColliderDesc.cylinder(spec.hy, spec.r!);
      // Same Y-rotation convention as three.js, so falaj's angled walls line up.
      const wx = poi.x + spec.x * c + spec.z * s;
      const wz = poi.z - spec.x * s + spec.z * c;
      const ry = (gRot + (spec.rotY ?? 0)) / 2;
      desc
        // Sample the terrain under each collider, matching the draped visuals so
        // a post's collider sits on the same dune the post does.
        .setTranslation(wx, heightAt(wx, wz) + spec.y, wz)
        .setRotation({ x: 0, y: Math.sin(ry), z: 0, w: Math.cos(ry) })
        .setFriction(0.7)
        .setRestitution(0.05);
      world.createCollider(desc);
    }
  }
}

function box(x: number, y: number, z: number, hx: number, hy: number, hz: number, rotY = 0): ColliderSpec {
  return { kind: 'box', x, y, z, hx, hy, hz, rotY };
}

function cyl(x: number, y: number, z: number, hy: number, r: number): ColliderSpec {
  return { kind: 'cyl', x, y, z, hy, r };
}

function colliderSpecs(id: PoiKind): ColliderSpec[] {
  switch (id) {
    case 'falaj':
      // The two low channel walls (baked group rotation handles the angle).
      return [box(0, 0.3, -0.75, 11, 0.35, 0.4), box(0, 0.3, 0.75, 11, 0.35, 0.4)];
    case 'ghaf':
      return [cyl(0, 1.7, 0, 1.7, 0.5)];
    case 'watchtower':
      return [cyl(0, 0.1, 0, 0.7, 4.4), cyl(0, 3.4, 0, 3.4, 2.8)];
    case 'majlis':
      // Banner pole and the central hearth; the floor and seats stay driveable.
      return [cyl(3.4, 2.3, -3.4, 2.3, 0.12), cyl(0, 0.12, 0, 0.16, 0.72)];
    case 'pylons': {
      const legs: ColliderSpec[] = [];
      for (const [x, z] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]] as const) {
        legs.push(box(x, 5.5, z, 0.18, 5.5, 0.18));
      }
      return legs;
    }
    case 'teastand':
      return [box(0, 0.58, 0, 1.35, 0.6, 0.78), box(-1.8, 0.3, 0.7, 0.32, 0.32, 0.32)];
    case 'famousdune': {
      // Only the three still-standing tripods; the fallen one and litter are flat.
      const specs: ColliderSpec[] = [];
      for (const i of [0, 1, 3]) {
        const a = i * 1.7;
        const d = 3 + i * 2.2;
        specs.push(cyl(Math.cos(a) * d, 0.75, Math.sin(a) * d, 0.75, 0.28));
      }
      return specs;
    }
    case 'falconry': {
      const specs: ColliderSpec[] = [];
      for (let i = 0; i < 5; i++) {
        specs.push(cyl(i * 1.5 - 3, 0.55, Math.sin(i * 1.3) * 0.5, 0.55, 0.14));
      }
      specs.push(cyl(3.6, 0.67, 1.6, 0.67, 0.1));
      return specs;
    }
    case 'cameltrack': {
      const specs: ColliderSpec[] = [];
      // Every rail post is solid, so crossing the track means threading them —
      // but driving straight down the middle stays clear.
      for (let i = -11; i <= 11; i++) {
        for (const side of [-3.2, 3.2]) specs.push(cyl(i * 3, 0.6, side, 0.62, 0.11));
      }
      // The starting gate: two heavier posts and the crossbar over them.
      for (const side of [-3.4, 3.4]) specs.push(cyl(-34, 1.3, side, 1.3, 0.14));
      specs.push(box(-34, 2.5, 0, 0.16, 0.16, 3.6));
      return specs;
    }
    case 'coffeehearth':
      // The hearth ring and the log seat; the pot and cups are too small to matter.
      return [cyl(0, 0.1, 0, 0.14, 0.62), box(-1.1, 0.16, 0.5, 0.16, 0.16, 0.55)];
  }
}
