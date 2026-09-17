import * as THREE from 'three';
import { surfaceMaterial } from './surfaceMaterial';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { duneFieldMask, hash2, heightAt, rockAt, softnessAt, surfaceAt } from '../terrain/height';

/**
 * Ground dressing — scrub, tussock grass and rocks — scattered across the
 * region so the desert reads as somewhere rather than a surface.
 *
 * Everything is instanced (§8), so the whole scatter costs one draw call per
 * species however many thousands of plants are on screen.
 *
 * Placement is deterministic: a cell's contents come from hashing its integer
 * coordinates, so a bush is in the same place every time you drive past it and
 * nothing needs to be stored. The cell set is filled in incrementally with a
 * per-frame budget — a full rebuild is several thousand `heightAt` calls, which
 * is a visible hitch every time the player crosses a cell boundary.
 */
const CELL = 10;
const RADIUS = 225;
const EVICT_RADIUS = RADIUS + CELL * 2;
/** New cells examined per frame. Keeps the cost off any single frame. */
const CELLS_PER_FRAME = 90;
const MAX_PER_SPECIES = 1800;

/** Vegetation avoids anything this steep — active dune faces are bare sand. */
const MAX_SLOPE = 0.42;
/** ...and anything looser than this. Plants hold in packed ground, not slip faces. */
const MAX_SOFTNESS = 0.62;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Merge parts that may mix indexed and non-indexed primitives.
 *
 * `mergeGeometries` returns null the moment one part carries an index buffer
 * and another doesn't, and three's polyhedra (Icosahedron, Dodecahedron) are
 * non-indexed while Box, Cone and Cylinder are indexed. The `?? parts[0]`
 * fallback this replaces made that failure invisible *and* destructive: the
 * bush merge was returning null on every call, so every bush in the world was
 * being drawn as `parts[0]` — one 24cm blob, with its other three blobs, six
 * twigs and stem silently discarded. Landmarks.ts already normalises this way;
 * the scatter needed to as well.
 */
function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = parts.map((p) => {
    if (!p.index) return p;
    const g = p.toNonIndexed();
    p.dispose();
    return g;
  });
  const merged = mergeGeometries(flat, false);
  if (!merged) {
    console.warn('[dune] scatter merge failed; falling back to a single part');
    return flat[0];
  }
  for (const g of flat) g.dispose();
  merged.computeBoundingSphere();
  return merged;
}

type Species = 'bush' | 'grass' | 'rock' | 'gravel';
const SPECIES: Species[] = ['bush', 'grass', 'rock', 'gravel'];

interface Placement {
  x: number;
  y: number;
  z: number;
  rotation: number;
  scale: number;
  species: Species;
}

export class Scatter {
  readonly group = new THREE.Group();

  private meshes: Record<Species, THREE.InstancedMesh>;
  private cells = new Map<string, Placement[]>();
  private queue: Array<[number, number]> = [];
  private lastCx = Infinity;
  private lastCz = Infinity;
  private dirty = false;
  private densityScale = 1;

  private dummy = new THREE.Object3D();

  constructor() {
    this.meshes = {
      bush: makeInstanced(buildBush(), 0x75745a, MAX_PER_SPECIES, false),
      grass: makeInstanced(buildGrass(), 0xaba084, MAX_PER_SPECIES, false),
      // Grey rather than warm: under this golden light a warm stone renders
      // olive and reads as more vegetation.
      rock: makeInstanced(buildRock(), 0x8e8270, MAX_PER_SPECIES / 2),
      gravel: makeInstanced(buildGravel(), 0xa99b85, 1800),
    };
    for (const s of SPECIES) this.group.add(this.meshes[s]);
    this.group.matrixAutoUpdate = false;
  }

  /** Drops every cached cell. The ground under all of them has been replaced. */
  reset() {
    this.cells.clear();
    this.lastCx = Infinity;
    this.lastCz = Infinity;
  }

  /** Lower tiers thin the scatter out rather than shrinking its radius. */
  setDensity(scale: number) {
    if (scale === this.densityScale) return;
    this.densityScale = scale;
    this.cells.clear();
    this.lastCx = Infinity;
    this.dirty = true;
  }

  update(x: number, z: number) {
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);

    if (cx !== this.lastCx || cz !== this.lastCz) {
      this.lastCx = cx;
      this.lastCz = cz;
      this.refreshQueue(cx, cz);
      this.evict(x, z);
    }

    let budget = CELLS_PER_FRAME;
    while (budget-- > 0 && this.queue.length > 0) {
      const [qx, qz] = this.queue.pop()!;
      const key = `${qx},${qz}`;
      if (this.cells.has(key)) continue;
      this.cells.set(key, this.buildCell(qx, qz));
      this.dirty = true;
    }

    if (this.dirty) {
      this.rebuildInstances();
      this.dirty = false;
    }
  }

  private refreshQueue(cx: number, cz: number) {
    const reach = Math.ceil(RADIUS / CELL);
    this.queue.length = 0;
    for (let dx = -reach; dx <= reach; dx++) {
      for (let dz = -reach; dz <= reach; dz++) {
        if (dx * dx + dz * dz > reach * reach) continue;
        const key = `${cx + dx},${cz + dz}`;
        if (this.cells.has(key)) continue;
        this.queue.push([cx + dx, cz + dz]);
      }
    }
    // Nearest last, because the queue is popped from the end.
    this.queue.sort((a, b) => {
      const da = (a[0] - cx) ** 2 + (a[1] - cz) ** 2;
      const db = (b[0] - cx) ** 2 + (b[1] - cz) ** 2;
      return db - da;
    });
  }

  private evict(x: number, z: number) {
    for (const [key, items] of this.cells) {
      const first = items[0];
      // Empty cells are cached too — they're the expensive answer to re-derive.
      const [kx, kz] = key.split(',').map(Number);
      const wx = first ? first.x : kx * CELL + CELL / 2;
      const wz = first ? first.z : kz * CELL + CELL / 2;
      if (Math.hypot(wx - x, wz - z) > EVICT_RADIUS) {
        this.cells.delete(key);
        this.dirty = true;
      }
    }
  }

  /**
   * Decides a cell's contents. The cheap tests (hash, softness) run before the
   * slope test, which needs two extra height samples.
   */
  private buildCell(cx: number, cz: number): Placement[] {
    const out: Placement[] = [];
    const baseX = cx * CELL;
    const baseZ = cz * CELL;

    const roll = hash2(cx, cz);
    // Density falls off inside dune fields: the corridors between them are
    // where anything actually grows.
    const field = duneFieldMask(baseX + CELL / 2, baseZ + CELL / 2);
    const patch = hash2(Math.floor(cx / 5), Math.floor(cz / 5));
    const chance = (0.92 - field * 0.46) * (0.5 + patch * 0.7) * this.densityScale;
    if (roll > chance) return out;

    const count = 1 + Math.floor(hash2(cx + 7919, cz - 104729) * 4);
    for (let i = 0; i < count; i++) {
      const h1 = hash2(cx * 31 + i, cz * 17 - i * 13);
      const h2 = hash2(cx * 13 - i * 7, cz * 29 + i);
      const x = baseX + h1 * CELL;
      const z = baseZ + h2 * CELL;

      const softness = softnessAt(x, z);

      const y = heightAt(x, z);
      const e = 1.4;
      const gx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e);
      const gz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
      if (Math.hypot(gx, gz) > MAX_SLOPE) continue;

      // Nothing holds on the great dune. Its faces are live sand being moved
      // constantly, and a bush halfway up a 120 m slip face would say the slope
      // is stable — which is the opposite of what the climb is about.
      //
      // Bare limestone is the same argument for the opposite reason: nothing
      // roots in rock, and a bush on the massif would undo the one hard-surface
      // read the region has.
      const surface = surfaceAt(x, z);
      const stony = Math.max(surface.greatDune, rockAt(x, z));
      const h3 = hash2(cx * 7 + i * 3, cz * 11 + i * 5);
      let species: Species;
      if (h3 < lerp(0.55, 0, stony)) species = 'bush';
      else if (h3 < lerp(0.85, 0.1, stony)) species = 'grass';
      else species = 'rock';

      if (softness > MAX_SOFTNESS) {
        if (softness > 0.80 || h3 < 0.74) continue;
        species = 'gravel';
      } else if (h3 > 0.68 && h3 < 0.91) species = 'gravel';
      out.push({
        x,
        // Sunk slightly so nothing appears to stand on tiptoe on a slope.
        y: y - 0.12,
        z,
        rotation: h1 * Math.PI * 2,
        scale: species === 'rock' ? 0.6 + Math.pow(h2, 4) * 3.5 : 0.75 + h2 * 0.85,
        species,
      });
    }
    return out;
  }

  private rebuildInstances() {
    const counts: Record<Species, number> = { bush: 0, grass: 0, rock: 0, gravel: 0 };

    for (const items of this.cells.values()) {
      for (const p of items) {
        const mesh = this.meshes[p.species];
        const index = counts[p.species];
        if (index >= mesh.instanceMatrix.count) continue;

        this.dummy.position.set(p.x, p.y, p.z);
        this.dummy.rotation.set(0, p.rotation, 0);
        this.dummy.scale.setScalar(p.scale);
        this.dummy.updateMatrix();
        mesh.setMatrixAt(index, this.dummy.matrix);
        counts[p.species] = index + 1;
      }
    }

    for (const s of SPECIES) {
      const mesh = this.meshes[s];
      mesh.count = counts[s];
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  get stats(): { bush: number; grass: number; rock: number } {
    return {
      bush: this.meshes.bush.count,
      grass: this.meshes.grass.count,
      rock: this.meshes.rock.count,
    };
  }
}

function makeInstanced(
  geometry: THREE.BufferGeometry,
  color: number,
  capacity: number,
  stone = true,
): THREE.InstancedMesh {
  const material = surfaceMaterial(color, 0.96, 0, 0.25, stone ? 'stone' : 'plain');
  const mesh = new THREE.InstancedMesh(geometry, material, Math.floor(capacity));
  mesh.count = 0;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // Instances are spread over hundreds of metres, so a single bounding sphere
  // would be meaningless — culling is handled by only ever placing them nearby.
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * Low, wiry desert scrub.
 *
 * Kept small and spiky rather than big and round: a smooth icosahedron at this
 * size reads as a boulder in the foreground, not a plant. The outward twigs are
 * what make it scan as scrub at a glance.
 */
function buildBush(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  // Sparse branches and narrow leaves let light pass through the shrub.
  for (let i = 0; i < 18; i++) {
    const a = i * 2.39996;
    const len = 0.24 + hash2(i, 77) * 0.28;
    const branch = new THREE.CylinderGeometry(0.003, 0.010, len, 4);
    branch.translate(0, len / 2, 0);
    branch.rotateZ(0.5 + hash2(i, 11) * 0.6);
    branch.rotateY(a);
    branch.translate(0, 0.1, 0);
    parts.push(branch);
    for (let j = 1; j <= 4; j++) {
      const leaf = new THREE.SphereGeometry(0.032, 4, 3);
      leaf.scale(1, 0.22, 0.46);
      leaf.rotateY(a + j);
      const reach = len * j / 5;
      leaf.translate(Math.cos(a) * reach * 0.75,
        0.12 + reach * 0.7, Math.sin(a) * reach * 0.75);
      parts.push(leaf);
    }
  }

  const stem = new THREE.CylinderGeometry(0.02, 0.035, 0.16, 4);
  stem.translate(0, 0.08, 0);
  parts.push(stem);
  return mergeParts(parts);
}

/** Tussock grass — a few stiff blades fanning out. */
function buildGrass(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 19; i++) {
    const a = (i / 19) * Math.PI * 2 + hash2(i, 3) * 0.6;
    const lean = 0.24 + hash2(i, 9) * 0.34;
    const h = 0.42 + hash2(i, 21) * 0.36;
    const blade = new THREE.ConeGeometry(0.012, h, 3);
    blade.translate(0, h / 2, 0);
    blade.rotateX(Math.sin(a) * lean);
    blade.rotateZ(Math.cos(a) * lean);
    blade.translate(Math.cos(a) * 0.07, 0, Math.sin(a) * 0.07);
    parts.push(blade);
  }
  return mergeParts(parts);
}

/**
 * A weathered stone, half-buried. Deliberately small — at boulder size these
 * stop reading as ground dressing and start looking like landmarks, which
 * competes with the actual landmarks.
 */
function buildRock(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(0.24, 2);
  const positions = g.getAttribute('position');
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    const scale = 1 + Math.sin(x * 31 + z * 17) * Math.sin(y * 27 + z * 9) * 0.14;
    positions.setXYZ(i, x * scale, y * scale, z * scale);
  }
  g.computeVertexNormals();
  g.scale(1, 0.6, 0.85);
  g.translate(0, 0.06, 0);
  return g;
}

/** A patch of wind-sorted gravel rather than one isolated pebble. */
function buildGravel(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 21; i++) {
    const a = hash2(i, 194) * Math.PI * 2, d = Math.sqrt(hash2(i, 719)) * 2.3;
    const r = 0.035 + hash2(i, 57) * 0.09;
    const stone = new THREE.IcosahedronGeometry(r, 0);
    stone.scale(1.3, 0.5, 0.9); stone.translate(Math.cos(a) * d, 0.12 + r * 0.15, Math.sin(a) * d);
    parts.push(stone);
  }
  return mergeParts(parts);
}
