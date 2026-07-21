import * as THREE from 'three';
import { clamp01, heightAt, softnessAt, smoothstep } from './height';

export const CHUNK_SIZE = 128;

/**
 * Cells per chunk edge for each LOD. Index 0 is what the wheels drive on, so it
 * matches the physics sampling exactly; each step out halves the resolution.
 */
export const LOD_RESOLUTIONS = [64, 32, 16, 8] as const;
export const PHYSICS_RESOLUTION = LOD_RESOLUTIONS[0];

/** How far chunk edges drop to hide cracks where two LODs meet. */
const SKIRT_DEPTH = 6;

/**
 * Index *data* depends only on the resolution, never on which chunk this is, so
 * it's built once per LOD and reused. Each geometry still wraps it in its own
 * BufferAttribute: sharing the attribute object would make one chunk's
 * `dispose()` free a GPU buffer that every other chunk at that LOD is still
 * drawing from.
 */
const indexCache = new Map<number, Uint16Array | Uint32Array>();

function buildIndices(n: number): Uint16Array | Uint32Array {
  const cached = indexCache.get(n);
  if (cached) return cached;

  const main = (n + 1) * (n + 1);
  const idx = (ix: number, iz: number) => ix * (n + 1) + iz;
  // Skirt vertices are appended after the grid, one strip per edge.
  const west = (iz: number) => main + iz;
  const east = (iz: number) => main + (n + 1) + iz;
  const south = (ix: number) => main + 2 * (n + 1) + ix;
  const north = (ix: number) => main + 3 * (n + 1) + ix;

  const tris = n * n * 2 + n * 4 * 2;
  const array = main + 4 * (n + 1) > 65535
    ? new Uint32Array(tris * 3)
    : new Uint16Array(tris * 3);

  let p = 0;
  const push = (a: number, b: number, c: number) => {
    array[p++] = a;
    array[p++] = b;
    array[p++] = c;
  };

  for (let ix = 0; ix < n; ix++) {
    for (let iz = 0; iz < n; iz++) {
      const a = idx(ix, iz);
      const b = idx(ix, iz + 1);
      const c = idx(ix + 1, iz + 1);
      const d = idx(ix + 1, iz);
      push(a, b, c);
      push(a, c, d);
    }
  }

  // Skirt walls. Winding is per-edge so each wall faces outward and survives
  // backface culling — an inverted skirt is invisible and silently useless.
  for (let iz = 0; iz < n; iz++) {
    const t0 = idx(0, iz);
    const t1 = idx(0, iz + 1);
    push(t0, west(iz), west(iz + 1));
    push(t0, west(iz + 1), t1);
  }
  for (let iz = 0; iz < n; iz++) {
    const t0 = idx(n, iz);
    const t1 = idx(n, iz + 1);
    push(t0, east(iz + 1), east(iz));
    push(t0, t1, east(iz + 1));
  }
  for (let ix = 0; ix < n; ix++) {
    const t0 = idx(ix, 0);
    const t1 = idx(ix + 1, 0);
    push(t0, south(ix + 1), south(ix));
    push(t0, t1, south(ix + 1));
  }
  for (let ix = 0; ix < n; ix++) {
    const t0 = idx(ix, n);
    const t1 = idx(ix + 1, n);
    push(t0, north(ix), north(ix + 1));
    push(t0, north(ix + 1), t1);
  }

  indexCache.set(n, array);
  return array;
}

// --- palette ------------------------------------------------------------------
// Warm and limited (§4). These are albedo, not final pixels — the indigo in the
// shadows comes from the hemisphere light, not from a dark version of the sand.
const LOOSE_SAND = new THREE.Color(0xd9a86a);
const CREST_BLEACH = new THREE.Color(0xe6c896);
const HARDPACK = new THREE.Color(0xc0a189);
const SABKHA = new THREE.Color(0xcbb9a6);

const scratchColor = new THREE.Color();

/**
 * Geometry for one chunk at one LOD. Positions are chunk-local; the mesh is
 * placed in the world by its transform, which keeps float precision sane far
 * from the origin.
 */
export function buildChunkGeometry(
  chunkX: number,
  chunkZ: number,
  n: number,
): THREE.BufferGeometry {
  const originX = chunkX * CHUNK_SIZE;
  const originZ = chunkZ * CHUNK_SIZE;
  const cell = CHUNK_SIZE / n;
  const verts = (n + 1) * (n + 1);
  const total = verts + 4 * (n + 1);

  const positions = new Float32Array(total * 3);
  const colors = new Float32Array(total * 3);
  const heights = new Float32Array(verts);

  for (let ix = 0; ix <= n; ix++) {
    const lx = ix * cell;
    const wx = originX + lx;
    for (let iz = 0; iz <= n; iz++) {
      const lz = iz * cell;
      const wz = originZ + lz;
      const h = heightAt(wx, wz);
      const v = ix * (n + 1) + iz;
      heights[v] = h;

      positions[v * 3] = lx;
      positions[v * 3 + 1] = h;
      positions[v * 3 + 2] = lz;

      writeColor(colors, v, wx, wz, h);
    }
  }

  // Skirts reuse their neighbouring edge vertex's colour so the seam can't
  // flicker a different hue if it does peek through.
  let s = verts;
  const pushSkirt = (ix: number, iz: number) => {
    const v = ix * (n + 1) + iz;
    positions[s * 3] = ix * cell;
    positions[s * 3 + 1] = heights[v] - SKIRT_DEPTH;
    positions[s * 3 + 2] = iz * cell;
    colors[s * 3] = colors[v * 3];
    colors[s * 3 + 1] = colors[v * 3 + 1];
    colors[s * 3 + 2] = colors[v * 3 + 2];
    s++;
  };
  for (let iz = 0; iz <= n; iz++) pushSkirt(0, iz);
  for (let iz = 0; iz <= n; iz++) pushSkirt(n, iz);
  for (let ix = 0; ix <= n; ix++) pushSkirt(ix, 0);
  for (let ix = 0; ix <= n; ix++) pushSkirt(ix, n);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(new THREE.BufferAttribute(buildIndices(n), 1));
  // `flatShading` derives normals per-fragment from screen-space derivatives,
  // so the attribute is never read — but three still expects it to exist.
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

function writeColor(out: Float32Array, v: number, wx: number, wz: number, h: number) {
  const soft = softnessAt(wx, wz);

  // Loose sand vs packed ground is the primary read, and it doubles as a legible
  // cue for where the truck will bog down.
  scratchColor.copy(HARDPACK).lerp(LOOSE_SAND, soft);
  // Sabkha floors sit low and firm.
  scratchColor.lerp(SABKHA, (1 - soft) * smoothstep(12, 2, h) * 0.7);
  // Crests catch the light and bleach out.
  scratchColor.lerp(CREST_BLEACH, clamp01(smoothstep(26, 62, h)) * 0.55);

  out[v * 3] = scratchColor.r;
  out[v * 3 + 1] = scratchColor.g;
  out[v * 3 + 2] = scratchColor.b;
}

/**
 * Height samples for one chunk in the layout Rapier's heightfield expects:
 * nalgebra is column-major and parry maps matrix *rows* to Z and *columns* to X,
 * so the flat index is `iz + ix * (n + 1)`. The collider is centred on the
 * chunk, so samples are taken about its centre to match.
 */
export function buildChunkHeightSamples(chunkX: number, chunkZ: number): Float32Array {
  const n = PHYSICS_RESOLUTION;
  const centreX = chunkX * CHUNK_SIZE + CHUNK_SIZE / 2;
  const centreZ = chunkZ * CHUNK_SIZE + CHUNK_SIZE / 2;
  const out = new Float32Array((n + 1) * (n + 1));
  for (let ix = 0; ix <= n; ix++) {
    const wx = centreX + (ix / n - 0.5) * CHUNK_SIZE;
    for (let iz = 0; iz <= n; iz++) {
      const wz = centreZ + (iz / n - 0.5) * CHUNK_SIZE;
      out[iz + ix * (n + 1)] = heightAt(wx, wz);
    }
  }
  return out;
}
