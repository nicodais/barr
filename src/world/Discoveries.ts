import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { heightAt } from '../terrain/height';

/**
 * Small things lying about that aren't POIs.
 *
 * The ten POIs are destinations: each one has a card, a radius, a pair of
 * scripted beats and a place on the compass. That's the right weight for a
 * watchtower, and completely the wrong weight for a dropped sandal. But a world
 * where the only things worth looking at are the ten labelled ones is a world
 * that has been fully surveyed, and the pleasure of driving around a desert is
 * finding something nobody told you was there.
 *
 * So: eleven bits of junk, each with exactly one Ahmed line, no card, no
 * compass entry, no persistence, no counter. Drive past, get a one-liner, keep
 * going. Nothing here is collected and nothing tracks whether you found it all
 * — the moment a discoverable has a tally next to it, it stops being a
 * discovery and becomes a chore (§11).
 *
 * All eleven bake into one merged mesh per material, so the whole system costs
 * about four draw calls (§8).
 */

const RUST = new THREE.MeshLambertMaterial({ color: 0x8c5a3c, flatShading: true });
const RUBBER = new THREE.MeshLambertMaterial({ color: 0x3f3a36, flatShading: true });
const PLASTIC = new THREE.MeshLambertMaterial({ color: 0xb85f52, flatShading: true });
const BONE = new THREE.MeshLambertMaterial({ color: 0xcfc3ad, flatShading: true });
const STONE = new THREE.MeshLambertMaterial({ color: 0x9c8b76, flatShading: true });
const CLOTH = new THREE.MeshLambertMaterial({ color: 0x7d8a9b, flatShading: true });

/** How close you have to get before Ahmed says anything. */
export const DISCOVERY_RADIUS = 22;

export type PropKind = 'tyre' | 'cairn' | 'fridge' | 'skull' | 'sandal' | 'drum' | 'chair';

export interface Discovery {
  kind: PropKind;
  x: number;
  z: number;
  /** Facing, radians. */
  rot: number;
  /** Ahmed's single line. One-liner only, never a pair (§13). */
  line: string;
}

/**
 * Scattered wide and deliberately not near the POIs — the whole value is that
 * you weren't going anywhere when you found it.
 */
export const DISCOVERIES: Discovery[] = [
  {
    kind: 'tyre', x: 95, z: 355, rot: 0.7,
    line: "Someone's spare. They didn't come back for it, so it's yours now.",
  },
  {
    kind: 'cairn', x: -415, z: -95, rot: 0,
    line: 'Stone pile. Somebody marked something here. No idea what.',
  },
  {
    kind: 'fridge', x: 430, z: 120, rot: 2.1,
    line: "That's a fridge. In the desert. I've stopped asking.",
  },
  {
    kind: 'skull', x: -230, z: -240, rot: 1.4,
    line: "Camel. Old one. Died somewhere with a view, at least.",
  },
  {
    kind: 'sandal', x: 620, z: 240, rot: 0.3,
    line: 'One sandal. Every single time, wallah, it is only ever one.',
  },
  {
    kind: 'drum', x: -560, z: -420, rot: 1.9,
    line: 'Fuel drum from the survey days. Empty since before I was born.',
  },
  {
    kind: 'chair', x: 250, z: 560, rot: 2.6,
    line: 'A plastic chair. Facing the sunset. Honestly, respect.',
  },
  {
    kind: 'tyre', x: -300, z: 640, rot: 2.2,
    line: "Another one. There's a man out here losing tyres professionally.",
  },
  {
    kind: 'cairn', x: 520, z: -420, rot: 0,
    line: 'Old route marker. The road it marked is under about nine metres of sand.',
  },
  {
    kind: 'skull', x: 700, z: 20, rot: 0.9,
    line: "Don't touch it. Not superstition, it's just grim.",
  },
  {
    kind: 'drum', x: -60, z: -700, rot: 0.5,
    line: "Someone burned rubbish in that. Out here. Where there is nothing to burn near.",
  },
];

export function createDiscoveries(): THREE.Group {
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const push = (mat: THREE.Material, geo: THREE.BufferGeometry) => {
    let list = buckets.get(mat);
    if (!list) buckets.set(mat, (list = []));
    // mergeGeometries returns null for a bucket mixing indexed and non-indexed
    // geometry, which silently deletes every piece sharing that material.
    // Normalise up front — this has bitten three separate systems here.
    list.push(geo.index ? geo.toNonIndexed() : geo);
  };

  const placer = new THREE.Object3D();
  for (const d of DISCOVERIES) {
    placer.position.set(d.x, heightAt(d.x, d.z), d.z);
    placer.rotation.set(0, d.rot, 0);
    placer.updateMatrix();
    for (const [mat, geo] of buildProp(d.kind)) {
      push(mat, geo.clone().applyMatrix4(placer.matrix));
    }
  }

  const group = new THREE.Group();
  for (const [mat, geos] of buckets) {
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!merged) {
      console.warn('[shamal] discovery bake dropped a material bucket');
      continue;
    }
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

/**
 * One prop, as material/geometry pairs in local space with ground at y=0.
 *
 * Everything here is half-buried on purpose. Nothing sits on top of sand out
 * there for more than a season, and a prop resting exactly on the surface reads
 * as having been placed by a level designer this morning.
 */
function buildProp(kind: PropKind): Array<[THREE.Material, THREE.BufferGeometry]> {
  switch (kind) {
    case 'tyre': {
      const tyre = new THREE.TorusGeometry(0.42, 0.17, 5, 9);
      tyre.rotateX(0.35);
      tyre.translate(0, 0.16, 0);
      const rim = new THREE.CylinderGeometry(0.2, 0.2, 0.16, 7);
      rim.rotateX(Math.PI / 2 + 0.35);
      rim.translate(0, 0.16, 0);
      return [[RUBBER, tyre], [RUST, rim]];
    }

    case 'cairn': {
      const parts: THREE.BufferGeometry[] = [];
      // Stacked, tapering, each stone rotated off the last. Six is enough to
      // read as deliberate rather than as rocks that happened to land.
      for (let i = 0; i < 6; i++) {
        const s = 0.42 - i * 0.05;
        const stone = new THREE.DodecahedronGeometry(s, 0);
        stone.scale(1, 0.6, 1);
        stone.rotateY(i * 1.3);
        stone.translate(Math.sin(i * 2.1) * 0.06, 0.1 + i * 0.32, Math.cos(i * 1.7) * 0.06);
        parts.push(stone);
      }
      return [[STONE, mergeGeometries(parts, false) ?? parts[0]]];
    }

    case 'fridge': {
      // On its back, door hanging, half swallowed.
      const body = new THREE.BoxGeometry(0.62, 1.5, 0.6);
      body.rotateX(Math.PI / 2 - 0.16);
      body.rotateZ(0.1);
      body.translate(0, 0.24, 0);
      const door = new THREE.BoxGeometry(0.58, 0.9, 0.07);
      door.rotateX(0.9);
      door.rotateZ(0.1);
      door.translate(0.05, 0.44, 0.68);
      return [[CLOTH, body], [PLASTIC, door]];
    }

    case 'skull': {
      // A camel skull is about half a metre long and the ribcage is two — sized
      // to that rather than to a hand-prop, because the first pass was a 30cm
      // box that was invisible from the twenty metres you'd spot it at.
      const cranium = new THREE.BoxGeometry(0.42, 0.36, 0.56);
      cranium.rotateZ(0.3);
      cranium.translate(0, 0.18, 0);
      const muzzle = new THREE.BoxGeometry(0.24, 0.21, 0.5);
      muzzle.rotateZ(0.3);
      muzzle.translate(0.13, 0.12, 0.48);
      const parts: THREE.BufferGeometry[] = [cranium, muzzle];
      // The ribcage out of the sand behind it, curving away — half a spine of
      // hoops is what actually reads as a carcass at distance, not the skull.
      for (let i = 0; i < 6; i++) {
        const rib = new THREE.TorusGeometry(0.46 - i * 0.03, 0.045, 4, 8, 1.9);
        rib.rotateY(Math.PI / 2);
        rib.rotateZ(0.45);
        rib.translate(-0.85 - i * 0.3, 0.02, -0.14 + i * 0.07);
        parts.push(rib.index ? rib.toNonIndexed() : rib);
      }
      return [[BONE, mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)), false) ?? cranium]];
    }

    case 'sandal': {
      const sole = new THREE.BoxGeometry(0.13, 0.035, 0.3);
      sole.rotateY(0.4);
      sole.rotateZ(-0.12);
      sole.translate(0, 0.03, 0);
      const strap = new THREE.BoxGeometry(0.12, 0.03, 0.04);
      strap.rotateY(0.4);
      strap.rotateX(0.5);
      strap.translate(0.01, 0.07, 0.03);
      return [[RUBBER, sole], [PLASTIC, strap]];
    }

    case 'drum': {
      // Tipped on its side and part-buried, with the ribs an oil drum has.
      const drum = new THREE.CylinderGeometry(0.29, 0.29, 0.88, 9);
      drum.rotateZ(Math.PI / 2);
      drum.rotateY(0.3);
      drum.translate(0, 0.17, 0);
      const parts = [drum.toNonIndexed()];
      for (const off of [-0.22, 0.22]) {
        const rib = new THREE.CylinderGeometry(0.31, 0.31, 0.06, 9);
        rib.rotateZ(Math.PI / 2);
        rib.rotateY(0.3);
        rib.translate(Math.cos(0.3) * off, 0.17, -Math.sin(0.3) * off);
        parts.push(rib.toNonIndexed());
      }
      return [[RUST, mergeGeometries(parts, false) ?? parts[0]]];
    }

    case 'chair': {
      const parts: THREE.BufferGeometry[] = [];
      const seat = new THREE.BoxGeometry(0.44, 0.05, 0.42);
      seat.translate(0, 0.4, 0);
      parts.push(seat);
      const back = new THREE.BoxGeometry(0.44, 0.42, 0.05);
      back.rotateX(-0.14);
      back.translate(0, 0.62, -0.2);
      parts.push(back);
      for (const sx of [-0.18, 0.18]) {
        for (const sz of [-0.16, 0.16]) {
          const leg = new THREE.BoxGeometry(0.04, 0.42, 0.04);
          // Legs sunk unevenly — one corner has gone into the sand, which is
          // the only reason a plastic chair ever looks like it belongs anywhere.
          leg.translate(sx, 0.19 + (sx > 0 ? -0.05 : 0), sz);
          parts.push(leg);
        }
      }
      const merged = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)), false);
      return [[PLASTIC, merged ?? seat.toNonIndexed()]];
    }
  }
}
