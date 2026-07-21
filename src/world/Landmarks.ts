import * as THREE from 'three';
import { POIS, type Poi } from '../data/pois';
import { heightAt } from '../terrain/height';

/**
 * The physical landmarks at each POI (§5). Flat-shaded primitives in the same
 * limited palette as the terrain — these are silhouettes on a ridge, not props
 * to inspect up close.
 *
 * They're visual only: no colliders. Driving through the ghaf tree is less bad
 * than a truck stopping dead on an invisible box in a game with no fail states,
 * and §11 rules out any damage model that would make a collision mean anything.
 */
const STONE = new THREE.MeshLambertMaterial({ color: 0x9c8b76, flatShading: true });
const DARK_STONE = new THREE.MeshLambertMaterial({ color: 0x7d6e5c, flatShading: true });
const RUST = new THREE.MeshLambertMaterial({ color: 0x8c5a3c, flatShading: true });
const WOOD = new THREE.MeshLambertMaterial({ color: 0x6f5439, flatShading: true });
const FOLIAGE = new THREE.MeshLambertMaterial({ color: 0x6b7f4a, flatShading: true });
const CANVAS = new THREE.MeshLambertMaterial({ color: 0xc4b49a, flatShading: true });
const METAL = new THREE.MeshLambertMaterial({ color: 0xa9a49b, flatShading: true });

export function createLandmarks(): THREE.Group {
  const group = new THREE.Group();
  for (const poi of POIS) {
    const built = buildLandmark(poi);
    built.position.set(poi.x, heightAt(poi.x, poi.z), poi.z);
    group.add(built);
  }
  return group;
}

function buildLandmark(poi: Poi): THREE.Group {
  switch (poi.id) {
    case 'falaj': return buildFalaj();
    case 'ghaf': return buildGhafTree();
    case 'watchtower': return buildWatchtower();
    case 'campsite': return buildCampsite();
    case 'pylons': return buildPylons();
    case 'teastand': return buildTeaStand();
    case 'famousdune': return buildFamousDune();
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
  const trunk = mesh(new THREE.CylinderGeometry(0.32, 0.55, 3.4, 6), WOOD, 0, 1.7, 0);
  trunk.rotation.z = 0.07;
  g.add(trunk);

  // Canopy is a cluster of low-poly blobs — wide and flat, the way a ghaf grows.
  const blob = new THREE.IcosahedronGeometry(1, 0);
  const canopy: Array<[number, number, number, number]> = [
    [0, 3.9, 0, 2.5], [1.7, 3.5, 0.5, 1.8], [-1.6, 3.6, -0.6, 1.9],
    [0.4, 3.3, -1.7, 1.6], [-0.6, 3.4, 1.6, 1.5],
  ];
  for (const [x, y, z, s] of canopy) {
    const m = mesh(blob, FOLIAGE, x, y, z);
    m.scale.set(s, s * 0.62, s);
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
  for (let i = 0; i < 5; i++) {
    const rock = mesh(new THREE.DodecahedronGeometry(2.4, 0), DARK_STONE,
      Math.cos(i * 1.3) * 3.2, -0.6, Math.sin(i * 1.3) * 3.2);
    rock.scale.set(1, 0.55, 1);
    rock.rotation.y = i;
    g.add(rock);
  }
  g.add(mesh(new THREE.CylinderGeometry(2.5, 3.1, 7.5, 9), STONE, 0, 3.6, 0));
  // Broken crown: a partial ring of merlons, most of them missing.
  for (let i = 0; i < 9; i++) {
    if (i % 3 === 1) continue;
    const a = (i / 9) * Math.PI * 2;
    const h = 0.75 + (i % 2) * 0.35;
    g.add(mesh(new THREE.BoxGeometry(0.75, h, 0.75), STONE,
      Math.cos(a) * 2.3, 7.4 + h / 2, Math.sin(a) * 2.3));
  }
  g.add(mesh(new THREE.BoxGeometry(1.1, 1.7, 0.4), DARK_STONE, 0, 2.4, 2.6));
  return g;
}

/** Fire-ring stones and flattened ground from a long-abandoned camp. */
function buildCampsite(): THREE.Group {
  const g = new THREE.Group();
  const stone = new THREE.DodecahedronGeometry(0.42, 0);
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2;
    const m = mesh(stone, i % 2 ? STONE : DARK_STONE,
      Math.cos(a) * 1.8, 0.2, Math.sin(a) * 1.8);
    m.rotation.set(i, i * 2, i * 3);
    m.scale.setScalar(0.8 + (i % 3) * 0.16);
    g.add(m);
  }
  // Charred remains in the middle, and the stubs of a shelter frame.
  g.add(mesh(new THREE.CylinderGeometry(1.05, 1.05, 0.1, 10), DARK_STONE, 0, 0.05, 0));
  for (const [x, z, r] of [[4.2, 1.1, 0.35], [3.4, -2.4, -0.2], [6.1, -0.9, 0.5]] as const) {
    const post = mesh(new THREE.CylinderGeometry(0.11, 0.13, 1.5, 5), WOOD, x, 0.6, z);
    post.rotation.z = r;
    g.add(post);
  }
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
  // Cross-bracing, thinning toward the top.
  for (let i = 1; i <= 5; i++) {
    const y = i * 1.9;
    const w = 3.4 - i * 0.22;
    g.add(mesh(new THREE.BoxGeometry(w, 0.16, 0.16), RUST, 0, y, -1.5 + i * 0.03));
    g.add(mesh(new THREE.BoxGeometry(0.16, 0.16, w), RUST, 1.5 - i * 0.03, y, 0));
  }
  g.add(mesh(new THREE.BoxGeometry(4.6, 0.2, 0.2), RUST, 0, 11.2, 0));

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
  g.add(mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.45, 6), WOOD, 1.7, 0.22, 0.9));
  g.add(mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), WOOD, -1.8, 0.3, 0.7));
  g.add(mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.3, 6), METAL, 0.6, 1.3, 0));
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
