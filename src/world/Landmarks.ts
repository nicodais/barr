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
