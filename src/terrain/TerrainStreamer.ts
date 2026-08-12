import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { heightAt } from './height';
import { PROFILES, type QualityProfile } from '../engine/Quality';
import {
  CHUNK_SIZE,
  LOD_RESOLUTIONS,
  PHYSICS_RESOLUTION,
  buildChunkGeometry,
  buildChunkHeightSamples,
  type EdgeRatios,
} from './chunkGeometry';
import { createSandMaterial, type SandUniforms } from './sandMaterial';
import { WIND_X, WIND_Z } from './height';

/** Extra slack before eviction, so chunks don't thrash on the boundary. */
const EVICT_SLACK = 160;
/**
 * Chunks each side of the player that get a physics collider (±256m). Not
 * scaled by quality: the wheels need the same ground on every device, and a
 * cheaper tier that let the truck fall through would be a bug, not a setting.
 */
const PHYSICS_CHUNK_RADIUS = 2;

interface Chunk {
  cx: number;
  cz: number;
  lod: number;
  /** Edge-stitching key ("w,e,s,n" ratios) the mesh was built with. */
  edges: string;
  mesh: THREE.Mesh | null;
  collider: RAPIER.Collider | null;
}

export interface TerrainStats {
  resident: number;
  colliders: number;
  pending: number;
}

/**
 * Streams the world in and out around the player: chunked heightfield, distance
 * LOD, frustum culling, no per-frame regeneration (§8).
 *
 * Physics and rendering are streamed on separate radii on purpose. Colliders
 * are expensive and only matter under the wheels, so they cover ±256m; meshes
 * are cheap and matter to the horizon, so they reach 900m at falling detail.
 */
export class TerrainStreamer {
  readonly group = new THREE.Group();
  readonly material: THREE.MeshLambertMaterial;
  /** Live shader uniforms for ripples and sheen — driven by SceneRig each frame. */
  readonly sand: SandUniforms;
  readonly stats: TerrainStats = { resident: 0, colliders: 0, pending: 0 };

  private chunks = new Map<string, Chunk>();
  private pending: Chunk[] = [];
  private focusX = 0;
  private focusZ = 0;
  private profile: QualityProfile = PROFILES.high;

  constructor(
    private rapier: typeof RAPIER,
    private world: RAPIER.World,
  ) {
    const sand = createSandMaterial();
    this.material = sand.material;
    this.sand = sand.uniforms;
    this.sand.uWind.value.set(WIND_X, WIND_Z);
    this.group.matrixAutoUpdate = false;
  }

  /**
   * Gets enough world up to start driving, then hands the rest to streaming.
   *
   * Colliders are always built eagerly by `refresh` — frame one must have ground
   * under the wheels. The meshes are time-budgeted instead of exhaustive:
   * building all ~156 resident chunks up front is a multi-second freeze on the
   * critical path, and since they're sorted nearest-first, whatever doesn't fit
   * in the budget is horizon detail that can fade in over the next second (§8).
   */
  preload(x: number, z: number, budgetMs = 350) {
    this.refresh(x, z);
    const deadline = performance.now() + budgetMs;
    while (this.pending.length > 0 && performance.now() < deadline) {
      this.buildNext();
    }
    this.updateStats();
  }

  /**
   * Confirms the physics colliders actually sit where the height function says
   * the ground is. A transposed sample layout or an off-by-half-a-chunk
   * translation is completely silent — the truck just floats or sinks — and the
   * chunked version has more ways to get this wrong than a single heightfield
   * did. Requires the query pipeline to have been primed.
   */
  verifyAlignment(originX: number, originZ: number): { ok: boolean; worstError: number } {
    const probes: Array<[number, number]> = [
      [0, 0], [40, 25], [-70, 90], [130, -110], [-180, -60], [200, 180], [-30, 210],
    ];
    let worst = 0;
    for (const [dx, dz] of probes) {
      const x = originX + dx;
      const z = originZ + dz;
      const expected = heightAt(x, z);
      const ray = new this.rapier.Ray({ x, y: expected + 80, z }, { x: 0, y: -1, z: 0 });
      const hit = this.world.castRay(ray, 240, true);
      if (!hit) {
        worst = Infinity;
        continue;
      }
      worst = Math.max(worst, Math.abs(expected + 80 - hit.timeOfImpact - expected));
    }
    // Heightfield triangles chord across 2m cells, so a small sag is expected.
    return { ok: worst < 1.0, worstError: worst };
  }

  update(x: number, z: number) {
    this.refresh(x, z);
    for (let i = 0; i < this.profile.chunkBudget && this.pending.length > 0; i++) {
      this.buildNext();
    }
    this.updateStats();
  }

  /**
   * Swaps the streaming profile. Chunks aren't torn down — the next refresh
   * notices their LOD no longer matches the new distances and rebuilds them
   * through the normal budgeted path, so a tier change never stalls a frame.
   */
  setQuality(profile: QualityProfile) {
    this.profile = profile;
  }

  /**
   * Throws away every chunk and collider. Called on a region change — the
   * height field under all of them has been replaced, so there is nothing here
   * worth keeping and a stale chunk would render a slice of the old map.
   */
  reset() {
    for (const chunk of this.chunks.values()) {
      if (chunk.mesh) {
        this.group.remove(chunk.mesh);
        chunk.mesh.geometry.dispose();
      }
      if (chunk.collider) this.world.removeCollider(chunk.collider, false);
    }
    this.chunks.clear();
    this.pending.length = 0;
    this.sand.uWind.value.set(WIND_X, WIND_Z);
    this.updateStats();
  }

  /** Reconciles the desired chunk set against what's resident. */
  private refresh(x: number, z: number) {
    this.focusX = x;
    this.focusZ = z;
    const centreCx = Math.floor(x / CHUNK_SIZE);
    const centreCz = Math.floor(z / CHUNK_SIZE);
    const reach = Math.ceil(this.profile.viewDistance / CHUNK_SIZE);

    this.pending.length = 0;

    // No world bound: chunks stream around the player wherever they go, so the
    // dune field is procedurally endless. The soft fade-and-respawn boundary
    // (WorldBoundary) turns players back well before they can drive far out.
    for (let cx = centreCx - reach; cx <= centreCx + reach; cx++) {
      for (let cz = centreCz - reach; cz <= centreCz + reach; cz++) {
        const dist = this.chunkDistance(cx, cz, x, z);
        if (dist > this.profile.viewDistance) continue;

        const key = `${cx},${cz}`;
        let chunk = this.chunks.get(key);
        if (!chunk) {
          chunk = { cx, cz, lod: -1, edges: '', mesh: null, collider: null };
          this.chunks.set(key, chunk);
        }

        // A chunk also rebuilds when a neighbour's LOD changes: its stitched
        // edges are baked against that neighbour's resolution, and a stale
        // stitch reopens the seam step it exists to remove.
        const wantLod = this.lodForDistance(dist);
        const wantEdges = this.edgeKey(cx, cz, wantLod, x, z);
        if (chunk.lod !== wantLod || chunk.edges !== wantEdges) this.pending.push(chunk);

        // Colliders are driven by chunk-grid distance, not euclidean, so the
        // supported area is a clean square with no corner gaps.
        const wantsCollider =
          Math.abs(cx - centreCx) <= PHYSICS_CHUNK_RADIUS &&
          Math.abs(cz - centreCz) <= PHYSICS_CHUNK_RADIUS;
        if (wantsCollider && !chunk.collider) {
          this.createCollider(chunk);
        } else if (!wantsCollider && chunk.collider) {
          this.world.removeCollider(chunk.collider, false);
          chunk.collider = null;
        }
      }
    }

    // Nearest first: detail arrives where the player is looking soonest.
    this.pending.sort(
      (a, b) => this.chunkDistance(a.cx, a.cz, x, z) - this.chunkDistance(b.cx, b.cz, x, z),
    );

    this.evict(x, z);
  }

  private buildNext() {
    const chunk = this.pending.shift();
    if (!chunk) return;

    const dist = this.chunkDistance(chunk.cx, chunk.cz, this.focusX, this.focusZ);
    const lod = this.lodForDistance(dist);
    const ratios = this.edgeRatios(chunk.cx, chunk.cz, lod, this.focusX, this.focusZ);

    if (chunk.mesh) {
      chunk.mesh.geometry.dispose();
      this.group.remove(chunk.mesh);
      chunk.mesh = null;
    }

    const geo = buildChunkGeometry(chunk.cx, chunk.cz, LOD_RESOLUTIONS[lod], ratios);
    // Positions are world-space and the mesh stays at identity — see
    // buildChunkGeometry for why this is what makes the seams watertight.
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.receiveShadow = true;
    // Dunes have to cast, not just receive: without this a ridge never shadows
    // the sand (or its own back face) behind it, so a low sun reads as shining
    // straight through the terrain. The tight shadow frustum (SceneRig) keeps
    // the self-shadowing crisp enough to avoid acne at these grazing angles.
    mesh.castShadow = true;
    mesh.updateMatrix();
    mesh.matrixAutoUpdate = false;

    chunk.mesh = mesh;
    chunk.lod = lod;
    chunk.edges = `${ratios.west},${ratios.east},${ratios.south},${ratios.north}`;
    this.group.add(mesh);
  }

  /**
   * Stitching ratios against each neighbour's LOD. LOD is a pure function of
   * distance-to-focus, so any chunk can compute its neighbours' resolutions
   * without them being resident, and every pair agrees about their shared edge.
   */
  private edgeRatios(cx: number, cz: number, lod: number, x: number, z: number): EdgeRatios {
    const n = LOD_RESOLUTIONS[lod];
    const r = (dcx: number, dcz: number) => {
      const neighbourLod = this.lodForDistance(this.chunkDistance(cx + dcx, cz + dcz, x, z));
      return Math.max(1, n / LOD_RESOLUTIONS[neighbourLod]);
    };
    return { west: r(-1, 0), east: r(1, 0), south: r(0, -1), north: r(0, 1) };
  }

  private edgeKey(cx: number, cz: number, lod: number, x: number, z: number): string {
    const e = this.edgeRatios(cx, cz, lod, x, z);
    return `${e.west},${e.east},${e.south},${e.north}`;
  }

  private createCollider(chunk: Chunk) {
    const samples = buildChunkHeightSamples(chunk.cx, chunk.cz);
    const desc = this.rapier.ColliderDesc.heightfield(
      PHYSICS_RESOLUTION,
      PHYSICS_RESOLUTION,
      samples,
      { x: CHUNK_SIZE, y: 1, z: CHUNK_SIZE },
    )
      .setTranslation(
        chunk.cx * CHUNK_SIZE + CHUNK_SIZE / 2,
        0,
        chunk.cz * CHUNK_SIZE + CHUNK_SIZE / 2,
      )
      .setFriction(1.0)
      .setRestitution(0);
    chunk.collider = this.world.createCollider(desc);
  }

  private evict(x: number, z: number) {
    for (const [key, chunk] of this.chunks) {
      if (this.chunkDistance(chunk.cx, chunk.cz, x, z) <= this.profile.viewDistance + EVICT_SLACK) continue;
      if (chunk.mesh) {
        this.group.remove(chunk.mesh);
        chunk.mesh.geometry.dispose();
      }
      if (chunk.collider) this.world.removeCollider(chunk.collider, false);
      this.chunks.delete(key);
    }
  }

  private chunkDistance(cx: number, cz: number, x: number, z: number): number {
    const centreX = cx * CHUNK_SIZE + CHUNK_SIZE / 2;
    const centreZ = cz * CHUNK_SIZE + CHUNK_SIZE / 2;
    return Math.hypot(centreX - x, centreZ - z);
  }

  private lodForDistance(dist: number): number {
    const d = this.profile.lodDistances;
    for (let i = 0; i < d.length; i++) {
      if (dist < d[i]) return i;
    }
    return LOD_RESOLUTIONS.length - 1;
  }

  private updateStats() {
    let colliders = 0;
    for (const chunk of this.chunks.values()) {
      if (chunk.collider) colliders++;
    }
    this.stats.resident = this.chunks.size;
    this.stats.colliders = colliders;
    this.stats.pending = this.pending.length;
  }
}


