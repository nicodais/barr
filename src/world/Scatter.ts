import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { duneFieldMask, hash2, heightAt, softnessAt } from '../terrain/height';

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
const CELL = 13;
const RADIUS = 165;
const EVICT_RADIUS = RADIUS + CELL * 2;
/** New cells examined per frame. Keeps the cost off any single frame. */
const CELLS_PER_FRAME = 90;
const MAX_PER_SPECIES = 1200;

/** Vegetation avoids anything this steep — active dune faces are bare sand. */
const MAX_SLOPE = 0.42;
/** ...and anything looser than this. Plants hold in packed ground, not slip faces. */
const MAX_SOFTNESS = 0.62;

type Species = 'bush' | 'grass' | 'rock';
const SPECIES: Species[] = ['bush', 'grass', 'rock'];

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
      bush: makeInstanced(buildBush(), 0x5f6b41, MAX_PER_SPECIES),
      grass: makeInstanced(buildGrass(), 0x968a58, MAX_PER_SPECIES),
      // Grey rather than warm: under this golden light a warm stone renders
      // olive and reads as more vegetation.
      rock: makeInstanced(buildRock(), 0x6b665f, MAX_PER_SPECIES / 2),
    };
    for (const s of SPECIES) this.group.add(this.meshes[s]);
    this.group.matrixAutoUpdate = false;
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
    const chance = (0.78 - field * 0.5) * this.densityScale;
    if (roll > chance) return out;

    const count = 1 + Math.floor(hash2(cx + 7919, cz - 104729) * 3);
    for (let i = 0; i < count; i++) {
      const h1 = hash2(cx * 31 + i, cz * 17 - i * 13);
      const h2 = hash2(cx * 13 - i * 7, cz * 29 + i);
      const x = baseX + h1 * CELL;
      const z = baseZ + h2 * CELL;

      if (softnessAt(x, z) > MAX_SOFTNESS) continue;

      const y = heightAt(x, z);
      const e = 1.4;
      const gx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e);
      const gz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
      if (Math.hypot(gx, gz) > MAX_SLOPE) continue;

      const h3 = hash2(cx * 7 + i * 3, cz * 11 + i * 5);
      const species: Species = h3 < 0.55 ? 'bush' : h3 < 0.85 ? 'grass' : 'rock';

      out.push({
        x,
        // Sunk slightly so nothing appears to stand on tiptoe on a slope.
        y: y - 0.12,
        z,
        rotation: h1 * Math.PI * 2,
        scale: 0.65 + h2 * 0.75,
        species,
      });
    }
    return out;
  }

  private rebuildInstances() {
    const counts: Record<Species, number> = { bush: 0, grass: 0, rock: 0 };

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
): THREE.InstancedMesh {
  const material = new THREE.MeshLambertMaterial({ color, flatShading: true });
  const mesh = new THREE.InstancedMesh(geometry, material, Math.floor(capacity));
  mesh.count = 0;
  mesh.castShadow = true;
  mesh.receiveShadow = false;
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
  const blobs: Array<[number, number, number, number]> = [
    [0, 0.2, 0, 0.24],
    [0.15, 0.14, 0.06, 0.17],
    [-0.12, 0.15, -0.09, 0.18],
    [0.03, 0.12, -0.16, 0.14],
  ];
  for (const [x, y, z, r] of blobs) {
    const g = new THREE.IcosahedronGeometry(r, 0);
    g.scale(1, 0.66, 1);
    g.translate(x, y, z);
    parts.push(g);
  }

  // Twigs poking out past the foliage.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + hash2(i, 41) * 0.9;
    const len = 0.2 + hash2(i, 77) * 0.18;
    const twig = new THREE.ConeGeometry(0.018, len, 3);
    twig.translate(0, len / 2, 0);
    twig.rotateX(Math.sin(a) * 0.85);
    twig.rotateZ(Math.cos(a) * 0.85);
    twig.translate(Math.cos(a) * 0.1, 0.14, Math.sin(a) * 0.1);
    parts.push(twig);
  }

  const stem = new THREE.CylinderGeometry(0.02, 0.035, 0.16, 4);
  stem.translate(0, 0.08, 0);
  parts.push(stem);
  return mergeGeometries(parts, false) ?? parts[0];
}

/** Tussock grass — a few stiff blades fanning out. */
function buildGrass(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + hash2(i, 3) * 0.6;
    const lean = 0.24 + hash2(i, 9) * 0.34;
    const h = 0.42 + hash2(i, 21) * 0.36;
    const blade = new THREE.ConeGeometry(0.045, h, 3);
    blade.translate(0, h / 2, 0);
    blade.rotateX(Math.sin(a) * lean);
    blade.rotateZ(Math.cos(a) * lean);
    blade.translate(Math.cos(a) * 0.07, 0, Math.sin(a) * 0.07);
    parts.push(blade);
  }
  return mergeGeometries(parts, false) ?? parts[0];
}

/**
 * A weathered stone, half-buried. Deliberately small — at boulder size these
 * stop reading as ground dressing and start looking like landmarks, which
 * competes with the actual landmarks.
 */
function buildRock(): THREE.BufferGeometry {
  const g = new THREE.DodecahedronGeometry(0.21, 0);
  g.scale(1, 0.6, 0.85);
  g.translate(0, 0.06, 0);
  return g;
}
