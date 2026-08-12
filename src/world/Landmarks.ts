import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Poi, PoiKind } from '../data/pois';
import { activeRegion } from '../terrain/regions';
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
/** Fossil shell against the rock it sits in — paler and warmer than limestone. */
const BONE_STONE = new THREE.MeshLambertMaterial({ color: 0xcabfa4, flatShading: true });
// The only saturated colour in the world, and it earns its place: against ochre
// sand a red carpet does more work than any amount of geometry, and a majlis
// without one is a patch of swept ground.
/**
 * Bait al-sha'ar: the black goat-hair tent. Dark on purpose and accurate on
 * purpose — the pale canvas these canopies started as read as a slab of
 * polystyrene floating over the sand, and a dark roof does the opposite job,
 * cutting a hard silhouette against a bright desert and throwing real shade
 * under itself.
 */
const TENT = new THREE.MeshLambertMaterial({ color: 0x3b332c, flatShading: true });
const TENT_LIGHT = new THREE.MeshLambertMaterial({ color: 0x4d4238, flatShading: true });
const CARPET = new THREE.MeshLambertMaterial({ color: 0x8e2f2a, flatShading: true });
const CARPET_DARK = new THREE.MeshLambertMaterial({ color: 0x5e2733, flatShading: true });
// Saker falcon: dark brown above, pale streaked breast.
const FALCON = new THREE.MeshLambertMaterial({ color: 0x8a6a45, flatShading: true });
const FALCON_DARK = new THREE.MeshLambertMaterial({ color: 0x5b452c, flatShading: true });
const FALCON_PALE = new THREE.MeshLambertMaterial({ color: 0xd9cbaf, flatShading: true });
// The oasis palette. Date palms are a colder, greyer green than the ghaf and
// the scrub — that difference is most of what makes a garden read as irrigated
// rather than as more desert vegetation.
const PALM = new THREE.MeshLambertMaterial({ color: 0x6f8450, flatShading: true });
const PALM_DARK = new THREE.MeshLambertMaterial({ color: 0x54663c, flatShading: true });
const PALM_TRUNK = new THREE.MeshLambertMaterial({ color: 0x8a6f4c, flatShading: true });
const DATES = new THREE.MeshLambertMaterial({ color: 0x9b5327, flatShading: true });
const MUD = new THREE.MeshLambertMaterial({ color: 0xa88a68, flatShading: true });
/** Standing water, and the only cool surface in the world. Deliberately dark —
    a shallow desert pool is a hole in the light, not a mirror. */
const WATER = new THREE.MeshLambertMaterial({ color: 0x3d5a5c, flatShading: true });

export function createLandmarks(): THREE.Group {
  const group = new THREE.Group();
  for (const poi of activeRegion().pois) {
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
/**
 * Wraps a built landmark so `drapeToTerrain` treats it as one rigid object.
 *
 * Draping settles every direct child on its own ground, which is right for
 * scattered dressing — rocks, blocks, fallen masonry — and completely wrong for
 * anything with structure. A canopy whose four poles each found their own
 * height tore the roof off them and left the guy ropes hanging in mid-air. One
 * child at the origin means the drape shift is zero and the assembly stays as
 * it was built; the POI pad has already flattened the ground under it anyway.
 */
function rigid(g: THREE.Group): THREE.Group {
  const wrapper = new THREE.Group();
  const outer = new THREE.Group();
  // `children` is live during reparenting, so take a copy first.
  for (const child of [...g.children]) outer.add(child);
  wrapper.add(outer);
  return wrapper;
}

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
    case 'pylons': return buildPylons(poi);
    case 'teastand': return buildTeaStand();
    case 'famousdune': return buildFamousDune();
    case 'falconry': return buildFalconry();
    case 'cameltrack': return buildCamelTrack();
    case 'coffeehearth': return buildCoffeeHearth();
    case 'oasis': return buildOasis();
    case 'fossilbed': return buildFossilBed();
    case 'tomb': return buildTomb();
  }
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/**
 * The falaj: a cut channel with its access shafts, half swallowed.
 *
 * The old version was a line of plain boxes and read as dropped shipping
 * crates. A falaj is a *cut* — a trench with dressed stone sides and water in
 * the bottom — and the thing that makes one recognisable from across a valley
 * is the row of vertical access shafts standing above it, spaced along the line
 * where the diggers went down. Those are the shape that says three-thousand-year
 * -old engineering rather than "some stones".
 *
 * Runs on an angle (see groupRotationY) and sinks into the sand at both ends,
 * because the desert is in the middle of swallowing it.
 */
function buildFalaj(): THREE.Group {
  const g = new THREE.Group();
  const LEN = 15;

  for (let i = -LEN; i <= LEN; i++) {
    const t = Math.abs(i) / LEN;
    // Buried at the ends, fully open in the middle.
    const open = 1 - t * t;
    const depth = 0.3 + open * 0.85;
    const z = i * 1.55;

    // Two dressed walls with the cut between them.
    for (const side of [-1, 1]) {
      const wall = mesh(
        new THREE.BoxGeometry(0.5, depth + 0.34, 1.5),
        (i + (side > 0 ? 1 : 0)) % 2 ? STONE : STONE_LIGHT,
        side * 0.78, (depth + 0.34) / 2 - depth + 0.16, z,
      );
      wall.rotation.y = ((i * 13) % 5) * 0.012;
      g.add(wall);
    }
    // Channel floor, and the water still lying in the deepest stretch.
    g.add(mesh(new THREE.BoxGeometry(1.1, 0.12, 1.5), DARK_STONE, 0, -depth + 0.08, z));
    if (open > 0.55) {
      g.add(mesh(new THREE.BoxGeometry(1.0, 0.06, 1.5), WATER, 0, -depth + 0.17, z));
    }
    // Capstones over part of the run — aflaj were covered to stop evaporation,
    // and a channel that is open end to end misses the point of building one.
    if (open > 0.3 && (i + 40) % 7 < 3) {
      const cap = mesh(new THREE.BoxGeometry(2.0, 0.16, 1.5), STONE_LIGHT, 0, 0.28, z);
      cap.rotation.y = ((i * 7) % 4) * 0.02;
      g.add(cap);
    }
  }

  // The access shafts. Stone collars standing proud of the ground, which is
  // what you actually see of a falaj from a distance.
  for (const sz of [-9.2, -1.5, 6.4]) {
    const ring = new THREE.Group();
    ring.position.set(0, 0, sz);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const block = mesh(new THREE.BoxGeometry(0.5, 0.34, 0.38), i % 2 ? STONE : STONE_LIGHT,
        Math.cos(a) * 1.08, 0.55 + (i % 3) * 0.07, Math.sin(a) * 1.08);
      block.rotation.y = -a;
      ring.add(block);
    }
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + 0.31;
      const block = mesh(new THREE.BoxGeometry(0.48, 0.34, 0.36), i % 2 ? STONE_LIGHT : STONE,
        Math.cos(a) * 1.08, 0.92, Math.sin(a) * 1.08);
      block.rotation.y = -a;
      ring.add(block);
    }
    // The hole itself, dark.
    ring.add(mesh(new THREE.CylinderGeometry(0.82, 0.82, 1.1, 10), DARK_STONE, 0, 0.5, 0));
    g.add(ring);
  }

  // A settling basin at the low end, where the water was drawn off.
  g.add(mesh(new THREE.BoxGeometry(4.4, 0.5, 3.6), STONE, 0, 0.05, LEN * 1.55 + 2.6));
  g.add(mesh(new THREE.BoxGeometry(3.4, 0.3, 2.6), WATER, 0, 0.24, LEN * 1.55 + 2.6));
  for (const [bx, bz] of [[-2.0, 0], [2.0, 0], [0, -1.7], [0, 1.7]] as const) {
    g.add(mesh(new THREE.BoxGeometry(bx === 0 ? 4.4 : 0.55, 0.62, bz === 0 ? 3.6 : 0.55),
      STONE_LIGHT, bx, 0.3, LEN * 1.55 + 2.6 + bz));
  }
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

/**
 * The watchtower: a round Emirati burj, and the tallest thing for kilometres.
 *
 * The first one stood about eight metres and read as a sandcastle. These towers
 * were built to see raiders coming across open country, which means the only
 * property that matters is that it *commands* — you should pick it out on the
 * horizon long before you can tell what it is, and it should still be looking
 * down at you when you park underneath. Nineteen metres on a rock knoll does
 * that; eight does not.
 *
 * Tapered, crenellated, one side fallen. The taper is the giveaway that it is
 * Gulf rather than generic-medieval: these are built of coral stone and mud
 * over a rubble core, so they batter inward hard.
 */
function buildWatchtower(): THREE.Group {
  const g = new THREE.Group();

  // Rock knoll. A tower on flat sand looks dropped; a tower on an outcrop looks
  // sited, which is the whole idea — someone chose this spot for the view.
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2 + 0.4;
    const d = 5.2 + (i % 3) * 1.5;
    const r = 1.5 + (i % 4) * 0.55;
    const rock = mesh(new THREE.DodecahedronGeometry(r, 0), i % 2 ? STONE : DARK_STONE,
      Math.cos(a) * d, 0.3 + (i % 3) * 0.25, Math.sin(a) * d);
    rock.scale.set(1, 0.5 + (i % 3) * 0.12, 1);
    rock.rotation.set(0.1, a, 0.06);
    g.add(rock);
  }

  const H = 19;
  const COURSES = 9;
  const baseR = 4.3;
  const topR = 2.9;

  // The shaft, as stacked courses. Each is a cylinder with a slightly different
  // radius and a small rotation, so the silhouette is hand-built rather than
  // turned on a lathe.
  for (let c = 0; c < COURSES; c++) {
    const t0 = c / COURSES;
    const t1 = (c + 1) / COURSES;
    const r0 = baseR + (topR - baseR) * t0;
    const r1 = baseR + (topR - baseR) * t1;
    const jitter = ((c * 7) % 5) * 0.035;
    const drum = mesh(
      new THREE.CylinderGeometry(r1 - jitter, r0 + jitter, H / COURSES + 0.05, 12),
      c % 2 ? STONE : STONE_LIGHT,
      0, H * (t0 + t1) / 2, 0,
    );
    drum.rotation.y = c * 0.13;
    g.add(drum);
  }

  // A string course two thirds up: one band of darker stone, which is what
  // stops nineteen metres of cylinder reading as a chimney.
  g.add(mesh(new THREE.CylinderGeometry(topR + 0.34, topR + 0.42, 0.6, 12), DARK_STONE, 0, H * 0.66, 0));

  // Parapet and crenellations. Half the merlons gone, weighted so one side of
  // the tower is visibly the weather side.
  g.add(mesh(new THREE.CylinderGeometry(topR + 0.5, topR + 0.3, 0.8, 12), STONE_LIGHT, 0, H + 0.4, 0));
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    // Standing through the lee arc, gone through the windward one.
    if (Math.cos(a - 2.2) > 0.35 && i % 3 !== 0) continue;
    const m = mesh(new THREE.BoxGeometry(1.05, 1.15 - (i % 3) * 0.3, 0.62), STONE,
      Math.cos(a) * (topR + 0.35), H + 1.35, Math.sin(a) * (topR + 0.35));
    m.rotation.y = -a;
    g.add(m);
  }

  // The door, high up and reached by a rope — these had no ground entrance,
  // which is the detail that explains what they were for.
  g.add(mesh(new THREE.BoxGeometry(1.5, 2.2, 0.5), DARK_STONE, 0, 6.4, baseR - 0.55));
  g.add(mesh(new THREE.BoxGeometry(1.9, 0.3, 0.7), WOOD, 0, 7.7, baseR - 0.5));

  // Arrow slits, in two rings.
  for (const [ring, count, y] of [[0, 6, 11.5], [1, 6, 15.4]] as const) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + ring * 0.5;
      const r = baseR + (topR - baseR) * (y / H);
      const slit = mesh(new THREE.BoxGeometry(0.28, 1.0, 0.4), DARK_STONE,
        Math.cos(a) * (r - 0.1), y, Math.sin(a) * (r - 0.1));
      slit.rotation.y = -a;
      g.add(slit);
    }
  }

  // Fallen masonry at the foot, on the collapsed side.
  for (let i = 0; i < 7; i++) {
    const a = 2.0 + i * 0.28;
    const d = baseR + 1.4 + (i % 3) * 1.3;
    const block = mesh(new THREE.BoxGeometry(1.2, 0.5, 0.9), i % 2 ? STONE : STONE_LIGHT,
      Math.cos(a) * d, 0.22, Math.sin(a) * d);
    block.rotation.set(0.08, a + i, 0.05);
    g.add(block);
  }
  return g;
}

/**
 * The majlis: an open-sided tent where a ruler held council on the sand.
 *
 * This was a flat brown disc with brick-shaped seats round it, and it read as a
 * helipad. What was missing is the thing that makes a majlis a majlis — it is
 * furnished. Carpets, cushions, a coffee hearth, a canopy for shade, and the
 * fact that all of it is the only saturated colour for kilometres. Against
 * ochre sand a deep red carpet does more work than any amount of geometry.
 *
 * Open on all four sides on purpose: no walls, no guards, anyone could sit. The
 * card says that and the model should agree with it.
 */
function buildMajlis(): THREE.Group {
  const g = new THREE.Group();
  const R = 7.4;

  // Swept ground, a shade darker and firmer than the sand around it.
  const floor = mesh(new THREE.CylinderGeometry(R, R + 0.3, 0.16, 16), MUD, 0, 0.05, 0);
  g.add(floor);

  // Carpets, laid as overlapping rectangles rather than one disc — a majlis is
  // rugs brought out and put down, not a fitted floor.
  for (const [x, z, w, d, rot, mat] of [
    [0, 0, 8.2, 5.6, 0.0, CARPET],
    [-2.4, 2.9, 5.0, 3.2, 0.32, CARPET_DARK],
    [3.0, -2.6, 4.4, 3.0, -0.24, CARPET_DARK],
  ] as const) {
    const rug = mesh(new THREE.BoxGeometry(w, 0.07, d), mat, x, 0.17, z);
    rug.rotation.y = rot;
    g.add(rug);
  }

  // Cushions round the edge, in two tones so the ring reads as seating rather
  // than as a kerb.
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + 0.2;
    const d = R - 1.5;
    const back = mesh(new THREE.BoxGeometry(1.5, 0.62, 0.5), i % 2 ? CARPET_DARK : CARPET,
      Math.cos(a) * d, 0.5, Math.sin(a) * d);
    back.rotation.y = -a;
    g.add(back);
    const seat = mesh(new THREE.BoxGeometry(1.4, 0.34, 0.85), CANVAS,
      Math.cos(a) * (d - 0.6), 0.34, Math.sin(a) * (d - 0.6));
    seat.rotation.y = -a;
    g.add(seat);
  }

  // The canopy: four poles and a slack roof, which is the silhouette you see
  // from a distance and the reason the place is habitable at midday.
  const CH = 3.5;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    g.add(mesh(new THREE.CylinderGeometry(0.11, 0.13, CH, 6), WOOD, sx * 4.6, CH / 2, sz * 4.6));
    // Guy ropes out to pegs, so the tent looks pitched rather than balanced.
    strutBetween(g, WOOD_DARK,
      [sx * 4.6, CH, sz * 4.6], [sx * 6.3, 0.1, sz * 6.3], 0.035);
    g.add(mesh(new THREE.BoxGeometry(0.14, 0.4, 0.14), WOOD_DARK, sx * 6.3, 0.2, sz * 6.3));
  }
  // A pitched roof, not a flat slab. Ridge 1.1m above the pole tops, two panels
  // sloping down to land exactly on them — the pitch is solved from the geometry
  // rather than guessed, so the fabric meets the poles instead of hovering over
  // them, which is what made the first one look like it was resting on air.
  const RISE = 1.1;
  const HALF_D = 4.6;
  const pitch = Math.atan2(RISE, HALF_D);
  const slopeLen = Math.hypot(HALF_D, RISE);
  for (const side of [-1, 1]) {
    const panel = mesh(new THREE.BoxGeometry(9.9, 0.09, slopeLen), side > 0 ? TENT : TENT_LIGHT,
      0, CH + RISE / 2, side * HALF_D / 2);
    panel.rotation.x = side * pitch;
    g.add(panel);
  }
  g.add(mesh(new THREE.BoxGeometry(10.1, 0.2, 0.34), TENT, 0, CH + RISE, 0));
  // Gable ends, so you can't see straight through the roof from the side.
  for (const side of [-1, 1]) {
    const gable = mesh(new THREE.BoxGeometry(0.1, RISE, HALF_D * 2), TENT_LIGHT,
      side * 4.9, CH + RISE / 2, 0);
    g.add(gable);
  }

  // The hearth in the middle, with the dallah on it. This is the actual centre
  // of the room: coffee is what a majlis is *for*.
  g.add(mesh(new THREE.CylinderGeometry(0.95, 1.1, 0.24, 10), DARK_STONE, 0, 0.28, 0));
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    g.add(mesh(new THREE.BoxGeometry(0.34, 0.26, 0.3), STONE,
      Math.cos(a) * 1.05, 0.34, Math.sin(a) * 1.05));
  }
  g.add(mesh(new THREE.ConeGeometry(0.22, 0.5, 7), RUST_DARK, 0, 0.52, 0));
  // Two dallah: bulbous body, long spout, tall lid. The most recognisable
  // object in the Gulf, and worth the six primitives.
  for (const [dx, dz, sc] of [[1.5, 0.9, 1], [-1.4, 1.2, 0.8]] as const) {
    g.add(mesh(new THREE.CylinderGeometry(0.26 * sc, 0.32 * sc, 0.5 * sc, 8), METAL, dx, 0.4 * sc, dz));
    g.add(mesh(new THREE.CylinderGeometry(0.16 * sc, 0.26 * sc, 0.26 * sc, 8), METAL, dx, 0.75 * sc, dz));
    g.add(mesh(new THREE.ConeGeometry(0.15 * sc, 0.34 * sc, 8), METAL, dx, 1.02 * sc, dz));
    const spout = mesh(new THREE.CylinderGeometry(0.05 * sc, 0.07 * sc, 0.55 * sc, 5), METAL,
      dx + 0.3 * sc, 0.72 * sc, dz);
    spout.rotation.z = -0.75;
    g.add(spout);
  }
  // Cups on a tray.
  g.add(mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.05, 10), METAL, -1.9, 0.22, -1.2));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    g.add(mesh(new THREE.CylinderGeometry(0.09, 0.07, 0.13, 6), STONE_LIGHT,
      -1.9 + Math.cos(a) * 0.28, 0.31, -1.2 + Math.sin(a) * 0.28));
  }

  // Banner pole, well outside the canopy so it breaks the skyline on its own.
  g.add(mesh(new THREE.CylinderGeometry(0.09, 0.11, 6.4, 6), WOOD, 6.2, 3.2, -6.2));
  const flag = mesh(new THREE.BoxGeometry(1.9, 1.15, 0.05), CARPET, 7.1, 5.6, -6.2);
  flag.rotation.y = 0.2;
  g.add(flag);
  return rigid(g);
}

/**
 * The survey pylons: a line of them, marching off across the dunes.
 *
 * The first version was one lattice tower with a scatter of ankle-high stakes
 * around it, and it read as abandoned scaffolding. The thing that makes a
 * pylon line photograph — the reason people stop the car for one — is not the
 * tower, it is the *repetition*: identical steel shapes stepping away over the
 * horizon with the cable sagging between them. One pylon is litter. Five is a
 * line, and a line has somewhere it came from and somewhere it is going.
 *
 * Each tower is its own sub-group so `drapeToTerrain` settles it on its own
 * ground. The cables can't be draped — a catenary that follows the dunes is not
 * a catenary — so the whole assembly hangs inside a single wrapper child, which
 * makes the drape a no-op, and every tower's footing height is sampled here
 * instead.
 */
function buildPylons(poi: Poi): THREE.Group {
  const g = new THREE.Group();
  // One child, positioned at the origin: drape shifts it by zero.
  const line = new THREE.Group();
  g.add(line);

  const baseY = heightAt(poi.x, poi.z);
  /** Bearing the line runs on, and the spacing between towers. */
  const DIR = 0.72;
  const SPAN = 34;
  const dx = Math.sin(DIR);
  const dz = Math.cos(DIR);

  const tops: Array<[number, number, number]> = [];
  for (let i = -2; i <= 2; i++) {
    const lx = dx * SPAN * i;
    const lz = dz * SPAN * i;
    const ground = heightAt(poi.x + lx, poi.z + lz) - baseY;
    // The far one has come down: a line that is entirely intact reads as
    // maintained, and the whole point of these is that nobody came back.
    const fallen = i === 2;
    const height = fallen ? 5.5 : 12.4 + (i % 2) * 0.6;

    const tower = buildPylonTower(height, fallen);
    tower.position.set(lx, ground, lz);
    tower.rotation.y = -DIR + (fallen ? 0.5 : 0);
    if (fallen) tower.rotation.z = 0.62;
    line.add(tower);

    if (!fallen) tops.push([lx, ground + height, lz]);

    // Concrete footings, which is all that is left where a tower is gone.
    for (const [ox, oz] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]] as const) {
      const c = Math.cos(-DIR), sn = Math.sin(-DIR);
      const fx = lx + ox * c + oz * sn;
      const fz = lz - ox * sn + oz * c;
      line.add(mesh(new THREE.BoxGeometry(0.8, 0.4, 0.8), STONE_LIGHT, fx, ground + 0.1, fz));
    }
  }

  // Cables. Two per span, hung from the ends of the cross-arm.
  for (let i = 0; i + 1 < tops.length; i++) {
    for (const side of [-1, 1]) {
      hangCable(line, tops[i], tops[i + 1], side * 1.9, DIR);
    }
  }
  return g;
}

/** One lattice tower: tapered legs, X-bracing, a cross-arm at the top. */
function buildPylonTower(height: number, stump: boolean): THREE.Group {
  const t = new THREE.Group();
  const baseR = 1.5;
  const topR = 0.62;
  const legs: Array<[number, number]> = [[-1, -1], [1, -1], [-1, 1], [1, 1]];

  // Legs as struts from footing to shoulder, so the taper is one straight
  // member rather than a stack of boxes stepping inward.
  for (const [sx, sz] of legs) {
    strutBetween(t, RUST,
      [sx * baseR, 0, sz * baseR],
      [sx * topR, height, sz * topR], 0.11);
  }

  // Bracing. X on each face at every level — the first pass used single random
  // diagonals, which is why it read as a step-ladder rather than a structure.
  const levels = Math.max(2, Math.round(height / 2.6));
  for (let l = 0; l < levels; l++) {
    const y0 = (l / levels) * height;
    const y1 = ((l + 1) / levels) * height;
    const r0 = baseR + (topR - baseR) * (l / levels);
    const r1 = baseR + (topR - baseR) * ((l + 1) / levels);
    for (const [ax, az, bx, bz] of [
      [-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1],
    ] as const) {
      strutBetween(t, RUST_DARK, [ax * r0, y0, az * r0], [bx * r1, y1, bz * r1], 0.05);
      strutBetween(t, RUST_DARK, [bx * r0, y0, bz * r0], [ax * r1, y1, az * r1], 0.05);
      // Horizontal belt closing the level.
      strutBetween(t, RUST, [ax * r1, y1, az * r1], [bx * r1, y1, bz * r1], 0.06);
    }
  }

  if (!stump) {
    // Cross-arm: the silhouette that says "power line" at any distance.
    t.add(mesh(new THREE.BoxGeometry(4.6, 0.16, 0.3), RUST, 0, height, 0));
    for (const side of [-1, 1]) {
      t.add(mesh(new THREE.BoxGeometry(0.12, 0.34, 0.12), DARK_STONE, side * 1.9, height - 0.24, 0));
      strutBetween(t, RUST_DARK, [side * 2.2, height, 0], [side * 0.5, height + 1.1, 0], 0.05);
    }
    t.add(mesh(new THREE.BoxGeometry(0.9, 0.12, 0.2), RUST, 0, height + 1.1, 0));
  }
  return t;
}

/**
 * A cable between two points, sagging under its own weight.
 *
 * Drawn as a run of short straight segments following a parabola, which is
 * indistinguishable from a real catenary over a span this short and is a great
 * deal cheaper than one. Twelve segments is the point where the joints stop
 * being visible against the sky.
 */
function hangCable(
  parent: THREE.Group,
  a: [number, number, number],
  b: [number, number, number],
  offset: number,
  dir: number,
) {
  const SEG = 12;
  const SAG = 2.6;
  // Offset runs across the line, so the two cables sit under the arm ends.
  const ox = Math.cos(dir) * offset;
  const oz = -Math.sin(dir) * offset;
  let prev: [number, number, number] | null = null;
  for (let i = 0; i <= SEG; i++) {
    const t = i / SEG;
    const x = a[0] + (b[0] - a[0]) * t + ox;
    const z = a[2] + (b[2] - a[2]) * t + oz;
    const y = a[1] + (b[1] - a[1]) * t - SAG * 4 * t * (1 - t);
    const here: [number, number, number] = [x, y - 0.3, z];
    if (prev) strutBetween(parent, DARK_STONE, prev, here, 0.045);
    prev = here;
  }
}

/** A cylinder spanning two local points. Same trick the vehicle cage uses. */
function strutBetween(
  parent: THREE.Group,
  material: THREE.Material,
  from: [number, number, number],
  to: [number, number, number],
  radius: number,
) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-4) return;
  const geo = new THREE.CylinderGeometry(radius, radius, len, 5);
  const q = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(dx / len, dy / len, dz / len),
  );
  geo.applyQuaternion(q);
  const m = new THREE.Mesh(geo, material);
  m.position.set((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
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
 * The falconry ground: birds on blocks under a shade, which is the only way
 * this reads as anything.
 *
 * It used to be a row of ankle-high posts with pale caps, indistinguishable
 * from parking bollards. The subject here is the *falcon* — it is the most
 * culturally loaded object available in this world and it was not in the model
 * at all. Four of them, hooded, on their blocks, under a low canopy, with the
 * lure and the water bowls that go with them.
 */
function buildFalconry(): THREE.Group {
  const g = new THREE.Group();

  // Low shade over the perch row. Falcons are kept out of the sun; the canopy
  // is not decoration, it is the reason the birds are here rather than there.
  const CH = 2.9;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    g.add(mesh(new THREE.CylinderGeometry(0.09, 0.11, CH, 6), WOOD, sx * 4.2, CH / 2, sz * 1.9));
    // Pegged inside the graded pad. A rigid group doesn't drape, so a guy rope
    // reaching past the flat ground drives its peg into thin air.
    strutBetween(g, WOOD_DARK, [sx * 4.2, CH, sz * 1.9], [sx * 5.2, 0.1, sz * 2.7], 0.03);
    g.add(mesh(new THREE.BoxGeometry(0.12, 0.34, 0.12), WOOD_DARK, sx * 5.2, 0.17, sz * 2.7));
  }
  // Same pitched-tent construction as the majlis, at working-shade scale.
  const RISE = 0.8;
  const HALF_D = 1.9;
  const pitch = Math.atan2(RISE, HALF_D);
  const slopeLen = Math.hypot(HALF_D, RISE);
  for (const side of [-1, 1]) {
    const panel = mesh(new THREE.BoxGeometry(9.0, 0.08, slopeLen), side > 0 ? TENT : TENT_LIGHT,
      0, CH + RISE / 2, side * HALF_D / 2);
    panel.rotation.x = side * pitch;
    g.add(panel);
  }
  g.add(mesh(new THREE.BoxGeometry(9.2, 0.16, 0.28), TENT, 0, CH + RISE, 0));

  // The birds. Body, breast, folded wings, head, hood, beak — six pieces each,
  // and the hood is the piece that makes it unmistakably a trained falcon
  // rather than a generic bird.
  for (let i = 0; i < 4; i++) {
    const x = -3.0 + i * 2.0;
    const z = Math.sin(i * 1.7) * 0.35;
    const face = 0.3 + i * 0.4;

    // Block: a padded post, which is what they actually perch on.
    g.add(mesh(new THREE.CylinderGeometry(0.24, 0.3, 0.9, 8), WOOD, x, 0.45, z));
    g.add(mesh(new THREE.CylinderGeometry(0.3, 0.26, 0.16, 8), CANVAS, x, 0.96, z));

    const bird = new THREE.Group();
    bird.position.set(x, 1.04, z);
    bird.rotation.y = face;
    const body = mesh(new THREE.IcosahedronGeometry(0.3, 0), FALCON, 0, 0.28, 0);
    body.scale.set(0.82, 1.15, 1.0);
    bird.add(body);
    const breast = mesh(new THREE.IcosahedronGeometry(0.2, 0), FALCON_PALE, 0, 0.25, 0.16);
    breast.scale.set(0.85, 1.1, 0.7);
    bird.add(breast);
    for (const side of [-1, 1]) {
      const wing = mesh(new THREE.BoxGeometry(0.1, 0.42, 0.24), FALCON_DARK, side * 0.2, 0.28, -0.03);
      wing.rotation.x = 0.16;
      bird.add(wing);
    }
    // Tail, angled down and back.
    const tail = mesh(new THREE.BoxGeometry(0.2, 0.32, 0.07), FALCON_DARK, 0, 0.12, -0.26);
    tail.rotation.x = 0.55;
    bird.add(tail);
    const head = mesh(new THREE.IcosahedronGeometry(0.15, 0), FALCON, 0, 0.6, 0.04);
    bird.add(head);
    // The burqa: a little leather hood with a plume on top.
    const hood = mesh(new THREE.ConeGeometry(0.14, 0.2, 7), CARPET_DARK, 0, 0.68, 0.04);
    bird.add(hood);
    bird.add(mesh(new THREE.BoxGeometry(0.03, 0.14, 0.03), WOOD_DARK, 0, 0.82, 0.04));
    bird.add(mesh(new THREE.ConeGeometry(0.05, 0.12, 5), METAL, 0, 0.58, 0.16));
    // Jess: the leash from the bird's leg down to the block.
    strutBetween(bird, WOOD_DARK, [0.04, 0.06, 0], [0.16, -0.7, 0.1], 0.018);
    g.add(bird);

    // Water bowl.
    g.add(mesh(new THREE.CylinderGeometry(0.26, 0.22, 0.12, 9), STONE, x + 0.7, 0.06, z + 0.9));
    g.add(mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.03, 9), WATER, x + 0.7, 0.12, z + 0.9));
  }

  // The lure on its cord, and the glove — the trainer's half of the kit.
  g.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.5, 6), WOOD, 5.0, 0.75, 1.6));
  const lure = mesh(new THREE.BoxGeometry(0.34, 0.16, 0.5), CARPET, 5.0, 1.42, 1.6);
  lure.rotation.set(0.3, 0.4, 0);
  g.add(lure);
  for (const side of [-1, 1]) {
    const wing = mesh(new THREE.BoxGeometry(0.42, 0.05, 0.2), CARPET_DARK, 5.0 + side * 0.3, 1.44, 1.6);
    wing.rotation.z = side * 0.4;
    g.add(wing);
  }
  // A crate of kit under the shade.
  g.add(mesh(new THREE.BoxGeometry(1.0, 0.6, 0.7), WOOD, -3.4, 0.3, 1.1));
  g.add(mesh(new THREE.BoxGeometry(0.9, 0.1, 0.6), WOOD_DARK, -3.4, 0.63, 1.1));
  return rigid(g);
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
/**
 * @returns every collider created, so a region change can take them back out.
 * Handing back the handles is the only way to remove them: Rapier has no notion
 * of "the colliders that belong to landmarks", and searching the world for them
 * afterwards would mean tagging them anyway.
 */
export function createLandmarkColliders(
  rapier: typeof RAPIER,
  world: RAPIER.World,
): RAPIER.Collider[] {
  const made: RAPIER.Collider[] = [];
  for (const poi of activeRegion().pois) {
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
      made.push(world.createCollider(desc));
    }
  }
  return made;
}

function box(x: number, y: number, z: number, hx: number, hy: number, hz: number, rotY = 0): ColliderSpec {
  return { kind: 'box', x, y, z, hx, hy, hz, rotY };
}

function cyl(x: number, y: number, z: number, hy: number, r: number): ColliderSpec {
  return { kind: 'cyl', x, y, z, hy, r };
}

function colliderSpecs(id: PoiKind): ColliderSpec[] {
  switch (id) {
    case 'falaj': {
      // The two channel walls, plus the shaft collars — those stand knee-high
      // and are the one part of a falaj you would actually hit.
      const specs: ColliderSpec[] = [
        box(-0.78, 0.3, 0, 0.3, 0.4, 23),
        box(0.78, 0.3, 0, 0.3, 0.4, 23),
      ];
      for (const sz of [-9.2, -1.5, 6.4]) specs.push(cyl(0, 0.5, sz, 0.6, 1.7));
      return specs;
    }
    case 'ghaf':
      return [cyl(0, 1.7, 0, 1.7, 0.5)];
    case 'watchtower':
      // The knoll and the shaft. Sized to the tower's own batter so you can
      // drive right up to the base without the collider standing off it.
      return [cyl(0, 0.4, 0, 0.9, 5.4), cyl(0, 9.5, 0, 9.5, 3.6)];
    case 'majlis':
      // Canopy poles, banner pole and the hearth. The carpets and cushions stay
      // driveable — running over the rugs should be embarrassing, not solid.
      return [
        ...([[-1, -1], [1, -1], [-1, 1], [1, 1]] as const).map(
          ([sx, sz]) => cyl(sx * 4.6, 1.75, sz * 4.6, 1.75, 0.16),
        ),
        cyl(6.2, 3.2, -6.2, 3.2, 0.14),
        cyl(0, 0.14, 0, 0.2, 1.1),
      ];
    case 'pylons': {
      // One collider per tower rather than per leg: sixteen thin boxes strung
      // over 140m of dune is a lot of geometry to catch a truck on, and a
      // pylon you can drive between the legs of is a pylon you get stuck in.
      const specs: ColliderSpec[] = [];
      const DIR = 0.72;
      for (let i = -2; i <= 2; i++) {
        const x = Math.sin(DIR) * 34 * i;
        const z = Math.cos(DIR) * 34 * i;
        const fallen = i === 2;
        specs.push(box(x, fallen ? 1.2 : 6.2, z, 1.5, fallen ? 1.2 : 6.2, 1.5, -DIR));
      }
      return specs;
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
      // Canopy poles and the perch blocks. The birds are not solid: clipping a
      // falcon should never be a collision event.
      const specs: ColliderSpec[] = ([[-1, -1], [1, -1], [-1, 1], [1, 1]] as const).map(
        ([sx, sz]) => cyl(sx * 4.2, 1.45, sz * 1.9, 1.45, 0.14),
      );
      for (let i = 0; i < 4; i++) {
        specs.push(cyl(-3.0 + i * 2.0, 0.5, Math.sin(i * 1.7) * 0.35, 0.5, 0.3));
      }
      specs.push(cyl(5.0, 0.75, 1.6, 0.75, 0.08));
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
    case 'fossilbed':
      // The two big slabs. The loose fossils and the marker post are small
      // enough that a collider on them would read as an invisible snag.
      return [box(-1.4, 0.35, 0.8, 2.6, 0.4, 1.7, 0.24), box(2.2, 0.28, -1.1, 2.1, 0.32, 1.5, -0.5)];
    case 'tomb': {
      // The ring wall, as eight boxes round the circumference. Driving into it
      // stops you; driving round it is the whole point of it being circular.
      const specs: ColliderSpec[] = [];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        specs.push(box(Math.cos(a) * 4.1, 0.55, Math.sin(a) * 4.1, 1.7, 0.6, 0.5, -a));
      }
      return specs;
    }
    case 'oasis': {
      // Every trunk is solid — a date garden you can drive through is a texture,
      // not a place. The pool and the basin wall stay flat so nothing traps you.
      const specs: ColliderSpec[] = PALMS.map((p) => cyl(p.x, 3, p.z, 3, 0.32));
      specs.push(box(0, 0.35, 5.4, 4.2, 0.4, 0.35));
      return specs;
    }
  }
}

/**
 * A date garden in an interdune hollow.
 *
 * Liwa is not a dune field with an oasis in it — it is a hundred-kilometre
 * crescent of date gardens that happens to be surrounded by the largest sand
 * sea on earth, and the family that founded the country came from them. Putting
 * one in the world is the single most place-specific thing here.
 *
 * It also does something no other landmark does: it is the only green, the only
 * water, and the only shade, and finding it after ten minutes of open sand is
 * the closest this game gets to an event.
 */
const PALMS: Array<{ x: number; z: number; h: number; lean: number }> = [
  { x: -6.2, z: -3.4, h: 7.4, lean: 0.06 },
  { x: -3.1, z: 2.8, h: 8.8, lean: -0.09 },
  { x: 1.4, z: -5.6, h: 6.6, lean: 0.11 },
  { x: 4.8, z: 0.9, h: 9.4, lean: -0.05 },
  { x: 7.9, z: -4.2, h: 7.1, lean: 0.08 },
  { x: -8.4, z: 3.9, h: 6.2, lean: -0.12 },
  { x: 0.6, z: 7.2, h: 8.1, lean: 0.04 },
  { x: 9.1, z: 4.6, h: 6.9, lean: -0.07 },
  { x: -1.8, z: -9.1, h: 7.7, lean: 0.09 },
];

function buildOasis(): THREE.Group {
  const g = new THREE.Group();

  for (const p of PALMS) g.add(buildDatePalm(p.x, p.z, p.h, p.lean));

  // The pool the whole thing exists for. Sunk just below grade with a mud rim,
  // so it reads as water in a hole rather than a green disc lying on the sand.
  const pool = mesh(new THREE.CylinderGeometry(3.1, 2.6, 0.3, 9), WATER, 0, -0.12, 3.2);
  pool.receiveShadow = true;
  g.add(pool);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const rim = mesh(new THREE.BoxGeometry(2.3, 0.34, 0.6), MUD,
      Math.cos(a) * 3.2, 0.1, 3.2 + Math.sin(a) * 3.2);
    rim.rotation.y = -a;
    g.add(rim);
  }

  // A stub of falaj feeding it, and the low basin wall that holds the flood.
  for (let i = 0; i < 6; i++) {
    g.add(mesh(new THREE.BoxGeometry(0.55, 0.5, 1.3), MUD, -0.7, 0.16, 6.6 + i * 1.2));
    g.add(mesh(new THREE.BoxGeometry(0.55, 0.5, 1.3), MUD, 0.7, 0.16, 6.6 + i * 1.2));
  }
  g.add(mesh(new THREE.BoxGeometry(8.4, 0.8, 0.7), MUD, 0, 0.3, 5.4));

  // Someone works here: a palm-frond ladder against a trunk, and crates for the
  // harvest. No people (§5 keeps the world empty), just the evidence of them.
  const ladder = new THREE.Group();
  for (const side of [-0.22, 0.22]) {
    ladder.add(mesh(new THREE.BoxGeometry(0.09, 4.4, 0.09), WOOD, side, 2.2, 0));
  }
  for (let i = 0; i < 7; i++) {
    ladder.add(mesh(new THREE.BoxGeometry(0.56, 0.07, 0.07), WOOD_DARK, 0, 0.5 + i * 0.6, 0));
  }
  ladder.position.set(4.2, 0, 1.6);
  ladder.rotation.set(0.19, 0.7, 0);
  g.add(ladder);

  for (const [cx, cz, r] of [[-4.4, 5.6, 0.3], [-3.4, 6.3, 1.1], [6.7, 6.1, -0.5]] as const) {
    g.add(mesh(new THREE.BoxGeometry(0.9, 0.55, 0.7), WOOD, cx, 0.28, cz)).rotation.y = r;
    g.add(mesh(new THREE.BoxGeometry(0.78, 0.12, 0.58), DATES, cx, 0.58, cz)).rotation.y = r;
  }

  // Reeds at the water's edge, because standing water in a desert is never
  // clean-edged — something always grows in it.
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + 0.4;
    const d = 2.9 + Math.random() * 0.7;
    const reed = mesh(new THREE.ConeGeometry(0.06, 0.9 + Math.random() * 0.6, 4), PALM_DARK,
      Math.cos(a) * d, 0.45, 3.2 + Math.sin(a) * d);
    reed.rotation.z = (Math.random() - 0.5) * 0.5;
    g.add(reed);
  }

  return g;
}

/** One date palm: ringed trunk, a crown of arching fronds, a hanging bunch. */
function buildDatePalm(x: number, z: number, height: number, lean: number): THREE.Group {
  const p = new THREE.Group();
  p.position.set(x, 0, z);
  p.rotation.z = lean;
  p.rotation.y = (x * 7.3 + z * 3.1) % Math.PI;

  const trunk = mesh(new THREE.CylinderGeometry(0.26, 0.42, height, 7), PALM_TRUNK, 0, height / 2, 0);
  p.add(trunk);
  // The stubs of shed fronds, which are the whole reason a date palm's trunk
  // reads as scaled rather than smooth. Cheap: eight boxes.
  const rings = Math.floor(height / 0.95);
  for (let i = 0; i < rings; i++) {
    const y = 0.6 + i * 0.95;
    const a = i * 2.4;
    const stub = mesh(new THREE.BoxGeometry(0.78, 0.2, 0.24), PALM_TRUNK,
      Math.cos(a) * 0.16, y, Math.sin(a) * 0.16);
    stub.rotation.y = -a;
    stub.rotation.z = 0.5;
    p.add(stub);
  }

  // The crown. Fronds are long thin wedges pitched down from horizontal, in two
  // tiers — the upper ones near-vertical and young, the lower ones drooping.
  const frond = new THREE.BoxGeometry(0.34, 0.07, 3.3);
  frond.translate(0, 0, 1.65);
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2;
    const upper = i % 3 === 0;
    const f = mesh(frond, upper ? PALM : PALM_DARK, 0, height - 0.1, 0);
    f.rotation.y = a;
    f.rotation.x = upper ? -0.55 : 0.28;
    f.scale.set(1, 1, upper ? 0.75 : 1);
    p.add(f);
  }
  // A short spray of new growth standing straight up out of the middle.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.6;
    const spike = mesh(new THREE.ConeGeometry(0.1, 1.5, 4), PALM, 0, height + 0.6, 0);
    spike.rotation.z = Math.cos(a) * 0.3;
    spike.rotation.x = Math.sin(a) * 0.3;
    p.add(spike);
  }

  // The dates themselves, hanging under the crown on one side.
  const bunch = mesh(new THREE.IcosahedronGeometry(0.42, 0), DATES, 0.75, height - 0.55, 0.2);
  bunch.scale.set(1, 1.5, 1);
  p.add(bunch);

  return p;
}

/**
 * The fossil bed: tilted slabs of marine limestone with the shells still in it.
 *
 * The fossils have to be legible or the POI is a pile of rocks, so they're
 * oversized — real ones are a few centimetres and would be invisible from a
 * truck. Scaled up to something you can see from standing height and left at
 * that, which is the same licence the whole flat-shaded style already takes.
 */
function buildFossilBed(): THREE.Group {
  const g = new THREE.Group();

  // Two big slabs tilted out of the ground at the dip of the bedding, which is
  // what a tilted seabed actually looks like where it breaks the surface.
  for (const [x, z, rot, tilt, len] of [
    [-1.4, 0.8, 0.24, -0.26, 5.2],
    [2.2, -1.1, -0.5, 0.2, 4.2],
  ] as const) {
    const slab = mesh(new THREE.BoxGeometry(len, 0.7, 3.4), STONE_LIGHT, x, 0.3, z);
    slab.rotation.set(tilt, rot, 0.06);
    g.add(slab);
  }

  // Smaller broken plates scattered off the slabs, half-buried.
  for (let i = 0; i < 11; i++) {
    const a = i * 2.4;
    const d = 3.4 + (i % 4) * 1.5;
    const plate = mesh(
      new THREE.BoxGeometry(0.9 + (i % 3) * 0.4, 0.16, 0.7),
      i % 2 ? STONE : DARK_STONE,
      Math.cos(a) * d, 0.06, Math.sin(a) * d,
    );
    plate.rotation.set((i % 3) * 0.1, a, 0.05);
    g.add(plate);
  }

  // The fossils. Ammonites as flat spirals — a torus with few segments reads as
  // a coiled shell at this poly count — plus urchins as squashed spheres.
  for (const [x, y, z, r, rot] of [
    [-1.9, 0.66, 1.4, 0.42, 0.3],
    [-0.6, 0.68, 0.1, 0.3, 1.1],
    [2.6, 0.62, -0.6, 0.36, -0.4],
  ] as const) {
    const shell = mesh(new THREE.TorusGeometry(r, r * 0.34, 4, 9), BONE_STONE, x, y, z);
    shell.rotation.set(Math.PI / 2 + 0.2, rot, 0);
    g.add(shell);
  }
  for (const [x, y, z, r] of [
    [-2.6, 0.64, 0.2, 0.2],
    [1.6, 0.6, -1.9, 0.16],
    [3.1, 0.58, -1.6, 0.22],
  ] as const) {
    const urchin = mesh(new THREE.IcosahedronGeometry(r, 0), BONE_STONE, x, y, z);
    urchin.scale.set(1, 0.5, 1);
    g.add(urchin);
  }

  // A survey marker: someone recorded this bed, which is what makes it a site
  // rather than a coincidence.
  g.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.5, 6), METAL, -4.6, 0.75, -2.2));
  const plate = mesh(new THREE.BoxGeometry(0.42, 0.3, 0.04), METAL, -4.6, 1.42, -2.2);
  plate.rotation.y = 0.4;
  g.add(plate);

  return g;
}

/**
 * An Umm an-Nar communal tomb: a circular dry-stone ring, partly collapsed.
 *
 * The real ones are 6-12m across with a dressed outer facing and internal
 * dividing walls, and they held whole extended families over generations. Built
 * here as a ring that is intact on one side and fallen on the other, because a
 * complete circle reads as a modern fire pit and a rubble pile reads as
 * nothing.
 */
function buildTomb(): THREE.Group {
  const g = new THREE.Group();
  const R = 4.1;

  // The ring. Height falls away round the circumference so one arc still
  // stands to chest height and the opposite arc is down to its foundation.
  const COURSES = 4;
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2;
    // Intact through the north-east arc, collapsed through the south-west.
    const standing = 0.35 + 0.65 * (0.5 + 0.5 * Math.cos(a - 1.0));
    const courses = Math.max(1, Math.round(COURSES * standing));
    for (let c = 0; c < courses; c++) {
      const jitter = ((i * 7 + c * 13) % 5) * 0.03;
      const block = mesh(
        new THREE.BoxGeometry(1.02, 0.26, 0.52),
        c % 2 ? STONE_LIGHT : STONE,
        Math.cos(a) * (R + jitter), 0.13 + c * 0.26, Math.sin(a) * (R + jitter),
      );
      block.rotation.y = -a + jitter * 0.4;
      g.add(block);
    }
  }

  // Internal dividing wall, which is the detail that makes it a tomb rather
  // than a hut: these were partitioned into chambers.
  for (const off of [-1.3, 1.3]) {
    for (let i = -2; i <= 2; i++) {
      g.add(mesh(new THREE.BoxGeometry(0.9, 0.24, 0.44), DARK_STONE, i * 1.0, 0.12, off));
    }
  }

  // Fallen facing stones lying where they came off the wall.
  for (let i = 0; i < 9; i++) {
    const a = 3.6 + i * 0.42;
    const d = R + 0.9 + (i % 3) * 0.7;
    const fallen = mesh(
      new THREE.BoxGeometry(0.95, 0.22, 0.5), STONE,
      Math.cos(a) * d, 0.09, Math.sin(a) * d,
    );
    fallen.rotation.set(0.04, a + (i % 4) * 0.3, 0.03);
    g.add(fallen);
  }

  return g;
}
