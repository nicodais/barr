import * as THREE from 'three';
import { alongCrest, clamp01, heightAt, surfaceAt } from './height';

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
  // Skirt vertices are appended after the grid: a TOP and BOTTOM ring per edge,
  // in the order west/east/south/north. The top ring is a separate set of
  // vertices recessed a few centimetres below the surface edge — walls must NOT
  // share vertices with the grid, or their top edge rasterises at exactly the
  // surface's depth and z-fights it, printing a dashed line along every seam.
  const ring = (k: number) => (i: number) => main + k * (n + 1) + i;
  const wTop = ring(0), wBot = ring(1), eTop = ring(2), eBot = ring(3);
  const sTop = ring(4), sBot = ring(5), nTop = ring(6), nBot = ring(7);

  const tris = n * n * 2 + n * 4 * 2;
  const array = main + 8 * (n + 1) > 65535
    ? new Uint32Array(tris * 3)
    : new Uint16Array(tris * 3);

  let p = 0;
  const push = (a: number, b: number, c: number) => {
    array[p++] = a;
    array[p++] = b;
    array[p++] = c;
  };

  const idx = (ix: number, iz: number) => ix * (n + 1) + iz;
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
  for (let i = 0; i < n; i++) {
    push(wTop(i), wBot(i), wBot(i + 1));
    push(wTop(i), wBot(i + 1), wTop(i + 1));

    push(eTop(i), eBot(i + 1), eBot(i));
    push(eTop(i), eTop(i + 1), eBot(i + 1));

    push(sTop(i), sBot(i + 1), sBot(i));
    push(sTop(i), sTop(i + 1), sBot(i + 1));

    push(nTop(i), nBot(i), nBot(i + 1));
    push(nTop(i), nBot(i + 1), nTop(i + 1));
  }

  indexCache.set(n, array);
  return array;
}

// --- palette ------------------------------------------------------------------
// Warm and limited (§4). These are albedo, not final pixels — the indigo in the
// shadows comes from the hemisphere light, not from a dark version of the sand.
//
// The two sands are the region, not a colour scheme. Inland Emirati dune sand is
// quartz wearing an iron-oxide coat, and the wind sorts it: the fine, deeply
// stained grains ride up onto the crests while the coarse pale ones lag in the
// interdune. So the map runs red along its ridges and grey-buff in its hollows,
// and the terrain shader doesn't decide that — `surfaceAt` does, from the same
// exposure term the dune geometry is built out of.
/** Iron-stained crest sand. This is the colour the corridor is known for. */
const SAND_IRON = new THREE.Color(0xba6b3e);
/** Coarse, pale, carbonate-rich interdune sand. */
const SAND_PALE = new THREE.Color(0xcaa887);
/** Serir — the wind-scoured gravel that shows through where sand runs thin. */
const GRAVEL = new THREE.Color(0xa1907c);
/** Salt crust on a pan floor: near-white, and the palest thing in the world. */
const SABKHA = new THREE.Color(0xd8cec0);
/**
 * The great dune's own faces, and the most saturated thing in the world.
 *
 * Tal Moreeb is the reddest sand in the region for the reason the grain-sorting
 * model already encodes — it is the highest and most exposed sand here, so it
 * collects the finest, most heavily iron-stained grains. Giving it a colour of
 * its own rather than leaning on the iron term alone is what lets it read as a
 * landmark from the far side of the map instead of as a big dune.
 */
const DUNE_CREST_RED = new THREE.Color(0xa8552c);

/**
 * What the dust and the crest plumes should be tinted toward, so airborne sand
 * belongs to the ground it came off rather than being a generic beige puff.
 */
export const AIRBORNE_SAND = new THREE.Color(0xd9a273);

const scratchColor = new THREE.Color();

/**
 * Ratio of this chunk's resolution to each neighbour's (1 when the neighbour is
 * the same or finer). Edges facing a coarser neighbour get their in-between
 * vertices snapped onto the neighbour's chord, so the two chunks meet exactly.
 */
export interface EdgeRatios {
  west: number;
  east: number;
  south: number;
  north: number;
}

export const FLAT_EDGES: EdgeRatios = { west: 1, east: 1, south: 1, north: 1 };

/**
 * Geometry for one chunk at one LOD. Positions are in WORLD space and every
 * chunk mesh renders at the identity transform. This is load-bearing for the
 * seams: with per-chunk transforms, two chunks' shared edge vertices go through
 * different matrix multiplies, the rasterizer's edge equations disagree by a
 * sub-pixel, and the boundary shows as a dashed hairline crack. Identical
 * attribute values through an identical transform are watertight by
 * construction. Float32 world coordinates are sub-millimetre out to the
 * boundary respawn range, so nothing is lost.
 */
export function buildChunkGeometry(
  chunkX: number,
  chunkZ: number,
  n: number,
  edges: EdgeRatios = FLAT_EDGES,
): THREE.BufferGeometry {
  const originX = chunkX * CHUNK_SIZE;
  const originZ = chunkZ * CHUNK_SIZE;
  const cell = CHUNK_SIZE / n;
  const verts = (n + 1) * (n + 1);
  const total = verts + 8 * (n + 1);

  const positions = new Float32Array(total * 3);
  const colors = new Float32Array(total * 3);
  const heights = new Float32Array(verts);

  for (let ix = 0; ix <= n; ix++) {
    const wx = originX + ix * cell;
    for (let iz = 0; iz <= n; iz++) {
      heights[ix * (n + 1) + iz] = heightAt(wx, originZ + iz * cell);
    }
  }

  // Stitch each edge that faces a coarser neighbour onto that neighbour's
  // chord line before positions are written. A step at an LOD seam is doubly
  // visible: it opens cracks, and — since the terrain casts shadows — the step
  // itself prints a dashed shadow line straight along the chunk boundary.
  // Corner vertices are index multiples of every ratio, so all four adjoining
  // chunks keep sampling them exactly and always agree.
  stitchEdge(heights, n, edges.west, (i) => i);
  stitchEdge(heights, n, edges.east, (i) => n * (n + 1) + i);
  stitchEdge(heights, n, edges.south, (i) => i * (n + 1));
  stitchEdge(heights, n, edges.north, (i) => i * (n + 1) + n);

  for (let ix = 0; ix <= n; ix++) {
    const wx = originX + ix * cell;
    for (let iz = 0; iz <= n; iz++) {
      const wz = originZ + iz * cell;
      const v = ix * (n + 1) + iz;
      const h = heights[v];

      // `originX + ix * cell` produces bitwise-identical floats in both chunks
      // sharing this vertex (integer arithmetic below 2^53), which is exactly
      // what makes the seam watertight.
      positions[v * 3] = wx;
      positions[v * 3 + 1] = h;
      positions[v * 3 + 2] = wz;

      writeColor(colors, v, wx, wz);
    }
  }

  // Two-ring skirts: the top ring is recessed just below the surface edge so
  // wall pixels are always strictly deeper than surface pixels (see the z-fight
  // note in buildIndices), and the bottom ring flares outward so any sliver
  // that ever shows is lit like a steep bit of dune, not a vertical wall.
  // The surface itself is watertight (bitwise-identical world-space edge
  // vertices + LOD stitching), so the skirt is insurance, not load-bearing.
  const SKIRT_FLARE = 2.5;
  const SKIRT_RECESS = 0.06;
  const SKIRT_SHADE = 0.82;
  let s = verts;
  const pushSkirt = (ix: number, iz: number, ox: number, oz: number, drop: number, shade: number) => {
    const v = ix * (n + 1) + iz;
    positions[s * 3] = originX + ix * cell + ox;
    positions[s * 3 + 1] = heights[v] - drop;
    positions[s * 3 + 2] = originZ + iz * cell + oz;
    colors[s * 3] = colors[v * 3] * shade;
    colors[s * 3 + 1] = colors[v * 3 + 1] * shade;
    colors[s * 3 + 2] = colors[v * 3 + 2] * shade;
    s++;
  };
  for (let iz = 0; iz <= n; iz++) pushSkirt(0, iz, 0, 0, SKIRT_RECESS, 1);
  for (let iz = 0; iz <= n; iz++) pushSkirt(0, iz, -SKIRT_FLARE, 0, SKIRT_DEPTH, SKIRT_SHADE);
  for (let iz = 0; iz <= n; iz++) pushSkirt(n, iz, 0, 0, SKIRT_RECESS, 1);
  for (let iz = 0; iz <= n; iz++) pushSkirt(n, iz, SKIRT_FLARE, 0, SKIRT_DEPTH, SKIRT_SHADE);
  for (let ix = 0; ix <= n; ix++) pushSkirt(ix, 0, 0, 0, SKIRT_RECESS, 1);
  for (let ix = 0; ix <= n; ix++) pushSkirt(ix, 0, 0, -SKIRT_FLARE, SKIRT_DEPTH, SKIRT_SHADE);
  for (let ix = 0; ix <= n; ix++) pushSkirt(ix, n, 0, 0, SKIRT_RECESS, 1);
  for (let ix = 0; ix <= n; ix++) pushSkirt(ix, n, 0, SKIRT_FLARE, SKIRT_DEPTH, SKIRT_SHADE);

  // Normals come from the height field analytically, not computeVertexNormals:
  // that helper only sees this chunk's triangles, so edge-row normals skew at
  // every chunk border. Lighting never notices (`flatShading` derives normals
  // per-fragment), but the shadow normalBias reads the attribute — and skewed
  // edge normals shift the shadow lookup, printing a dashed acne line exactly
  // along every seam. Central differences of the same heightAt field give all
  // chunks identical normals at shared vertices.
  const normals = new Float32Array(total * 3);
  for (let ix = 0; ix <= n; ix++) {
    const wx = originX + ix * cell;
    for (let iz = 0; iz <= n; iz++) {
      const wz = originZ + iz * cell;
      const v = ix * (n + 1) + iz;
      const hxm = ix > 0 ? heights[v - (n + 1)] : heightAt(wx - cell, wz);
      const hxp = ix < n ? heights[v + (n + 1)] : heightAt(wx + cell, wz);
      const hzm = iz > 0 ? heights[v - 1] : heightAt(wx, wz - cell);
      const hzp = iz < n ? heights[v + 1] : heightAt(wx, wz + cell);
      const nx = (hxm - hxp) / (2 * cell);
      const nz = (hzm - hzp) / (2 * cell);
      const inv = 1 / Math.hypot(nx, 1, nz);
      normals[v * 3] = nx * inv;
      normals[v * 3 + 1] = inv;
      normals[v * 3 + 2] = nz * inv;
    }
  }
  // Skirt vertices reuse their edge vertex's normal, mirroring the colour copy
  // — once per ring, in the same top/bottom order pushSkirt wrote them.
  s = verts;
  const copyNormal = (ix: number, iz: number) => {
    const v = ix * (n + 1) + iz;
    normals[s * 3] = normals[v * 3];
    normals[s * 3 + 1] = normals[v * 3 + 1];
    normals[s * 3 + 2] = normals[v * 3 + 2];
    s++;
  };
  for (let r = 0; r < 2; r++) for (let iz = 0; iz <= n; iz++) copyNormal(0, iz);
  for (let r = 0; r < 2; r++) for (let iz = 0; iz <= n; iz++) copyNormal(n, iz);
  for (let r = 0; r < 2; r++) for (let ix = 0; ix <= n; ix++) copyNormal(ix, 0);
  for (let r = 0; r < 2; r++) for (let ix = 0; ix <= n; ix++) copyNormal(ix, n);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(new THREE.BufferAttribute(buildIndices(n), 1));
  geo.computeBoundingSphere();
  return geo;
}

/** Replaces in-between edge samples with the coarser neighbour's chord. */
function stitchEdge(
  heights: Float32Array,
  n: number,
  ratio: number,
  at: (i: number) => number,
) {
  if (ratio <= 1) return;
  for (let i = 1; i < n; i++) {
    const rem = i % ratio;
    if (rem === 0) continue;
    const i0 = i - rem;
    const t = rem / ratio;
    heights[at(i)] = heights[at(i0)] * (1 - t) + heights[at(i0 + ratio)] * t;
  }
}

function writeColor(out: Float32Array, v: number, wx: number, wz: number) {
  const s = surfaceAt(wx, wz);

  // Grain sorting first: this is the primary read of the whole landscape, red
  // ridges falling away to pale floors.
  scratchColor.copy(SAND_PALE).lerp(SAND_IRON, s.iron);
  // Where the sand runs thin the gravel underneath shows through. Partial on
  // purpose — hardpack here is sand *over* serir, not bare serir.
  scratchColor.lerp(GRAVEL, (1 - s.softness) * 0.45);
  // Then the salt pan, and the great dune over the top of everything — nothing
  // buries it, because it is 120 m of sand standing on the lot.
  scratchColor.lerp(SABKHA, s.sabkha);
  scratchColor.lerp(DUNE_CREST_RED, s.greatDune * 0.5);

  // Wind lanes: faint streaking drawn out along the crest lines, the direction
  // the sand is actually travelling. Kept to a few percent — at any strength
  // where you'd notice it as stripes it stops reading as wind and starts
  // reading as a texture seam.
  const lane = 1 + Math.sin(alongCrest(wx, wz) * 0.021) * 0.03 * s.softness;
  scratchColor.multiplyScalar(lane);

  out[v * 3] = clamp01(scratchColor.r);
  out[v * 3 + 1] = clamp01(scratchColor.g);
  out[v * 3 + 2] = clamp01(scratchColor.b);
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
