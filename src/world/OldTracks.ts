import * as THREE from 'three';
import { GREAT_DUNE, heightAt } from '../terrain/height';

/**
 * Tracks that were already here.
 *
 * An empty desert with one set of fresh tyre marks in it says the player is the
 * first person ever to drive here, which is the opposite of what this place is.
 * Liwa is *busy* — there is a graded road in, there are people at the tea stand,
 * and the run up to Tal Moreeb is braided with a hundred previous attempts. Old
 * tracks are how a world says "this is somewhere people go" without a single
 * NPC, and they do a second job on top of that: they're a soft wayfinding cue.
 * Follow the ruts and they take you somewhere, which is exactly the
 * non-directive nudge §5 asks for.
 *
 * Baked once at load into a single static mesh — the routes never change, and a
 * thousand metres of ribbon is one draw call (§8).
 */

/** Sample spacing along a route, metres. */
const STEP = 3;
/** Half-width of one wheel rut. */
const HALF_WIDTH = 0.22;
/** Distance between the two ruts of a vehicle. */
const TRACK_GAUGE = 0.9;
/** Vertical clearance over the sand. Vertical, not along the normal — the
    difference is under a centimetre at any slope these routes cross. */
const LIFT = 0.12;

/**
 * Where the graded road reaches the sand, and where everything leads from. It
 * sits beside Ahmed's tea stand, which is the joke: the road ends, and the
 * first thing anyone finds is a police officer making karak.
 */
const ACCESS = { x: -742, z: 668 };
const TEA_STAND = { x: -680, z: 600 };
const WATCHTOWER = { x: 600, z: 470 };

interface Route {
  /** Control points; the path is a Catmull-Rom through them. */
  points: Array<{ x: number; z: number }>;
  /** How heavily used, 0..1 — drives opacity. */
  traffic: number;
  /** Extra parallel lines each side, for a braided approach. */
  braid?: number;
  /** Lateral spacing of the braid, metres. */
  braidSpread?: number;
}

const ROUTES: Route[] = [
  // The main run: road head, past the tea stand, then a long diagonal across
  // the interdune corridors to the foot of the great dune. Bent deliberately —
  // nobody drives a straight line through a dune field, they follow the
  // corridors, and a ruler-straight track would read as a painted road.
  {
    points: [
      ACCESS,
      TEA_STAND,
      { x: -560, z: 480 },
      { x: -430, z: 300 },
      { x: -250, z: 210 },
      { x: -80, z: 120 },
      { x: 60, z: -20 },
      { x: 170, z: -120 },
      { x: GREAT_DUNE.x - 60, z: GREAT_DUNE.z + 130 },
    ],
    traffic: 1,
  },
  // The pilgrimage. Everyone takes a run at the same face, everyone takes a
  // slightly different line, and the result is a fan of parallel scars that is
  // the single most recognisable thing about a famous dune.
  {
    points: [
      { x: GREAT_DUNE.x - 60, z: GREAT_DUNE.z + 130 },
      { x: GREAT_DUNE.x - 20, z: GREAT_DUNE.z + 95 },
      { x: GREAT_DUNE.x + 5, z: GREAT_DUNE.z + 55 },
    ],
    traffic: 1,
    braid: 4,
    braidSpread: 7,
  },
  // A quieter spur out to the watchtower — fainter, because far fewer people
  // bother going that far.
  {
    points: [
      { x: -80, z: 120 },
      { x: 90, z: 210 },
      { x: 260, z: 300 },
      { x: 420, z: 400 },
      { x: WATCHTOWER.x - 30, z: WATCHTOWER.z - 10 },
    ],
    traffic: 0.55,
  },
];

const VERTEX = /* glsl */ `
  attribute float aAlpha;
  varying float vAlpha;
  varying vec3 vWorld;
  void main() {
    vAlpha = aAlpha;
    vec4 world = modelMatrix * vec4( position, 1.0 );
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  varying vec3 vWorld;
  void main() {
    // Fade out with distance. These ribbons are draped on the full-resolution
    // height field, but the terrain they lie on drops to a quarter of that
    // resolution by 300m, and a ribbon that sinks under a coarse chord shows as
    // a dashed line. Gone before that happens.
    float dist = length( vWorld - cameraPosition );
    float a = vAlpha * ( 1.0 - smoothstep( 190.0, 330.0, dist ) );
    if ( a <= 0.004 ) discard;
    gl_FragColor = vec4( uColor, a );
  }
`;

/** Deterministic hash, so the same world always weathers the same way. */
function wobble(t: number, seed: number): number {
  const s = Math.sin(t * 0.037 + seed) * 0.6 + Math.sin(t * 0.0091 + seed * 2.3) * 0.4;
  return s;
}

export function createOldTracks(): THREE.Mesh {
  const positions: number[] = [];
  const alphas: number[] = [];
  const indices: number[] = [];

  for (let r = 0; r < ROUTES.length; r++) {
    const route = ROUTES[r];
    const curve = new THREE.CatmullRomCurve3(
      route.points.map((p) => new THREE.Vector3(p.x, 0, p.z)),
      false,
      'catmullrom',
      0.4,
    );
    const length = curve.getLength();
    const stations = Math.max(2, Math.round(length / STEP));
    const spaced = curve.getSpacedPoints(stations);

    const lanes = route.braid ?? 0;
    for (let lane = -lanes; lane <= lanes; lane++) {
      const laneOffset = lane * (route.braidSpread ?? 6);
      // Each line of a braid is its own attempt, so each gets its own wander
      // and its own wear. Without the per-lane seed the fan is a comb.
      const seed = r * 31.7 + lane * 8.3;
      const laneTraffic = route.traffic * (lane === 0 ? 1 : 0.45 + 0.3 * Math.abs(Math.sin(seed)));
      emitLine(positions, alphas, indices, spaced, laneOffset, laneTraffic, seed);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aAlpha', new THREE.Float32BufferAttribute(alphas, 1));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();

  const material = new THREE.ShaderMaterial({
    // A shade cooler and darker than fresh tracks: a rut that has been sitting
    // has lost the loose bright sand off its lip and is packed inside.
    uniforms: { uColor: { value: new THREE.Color(0x7d5d3f) } },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  // Under the player's own fresh tracks (renderOrder 2): driving over an old
  // line should leave a new one on top of it.
  mesh.renderOrder = 1;
  return mesh;
}

/**
 * One vehicle's worth of track — two ruts — draped along a path.
 *
 * @param offset lateral shift of the whole line, for braiding
 * @param traffic 0..1 how worn this line is
 */
function emitLine(
  positions: number[],
  alphas: number[],
  indices: number[],
  path: THREE.Vector3[],
  offset: number,
  traffic: number,
  seed: number,
) {
  // Two ruts, laid as separate strips so a strip never joins across the gauge.
  for (const side of [-1, 1]) {
    const start = positions.length / 3;
    let travelled = 0;

    for (let i = 0; i < path.length; i++) {
      const prev = path[Math.max(0, i - 1)];
      const next = path[Math.min(path.length - 1, i + 1)];
      let tx = next.x - prev.x;
      let tz = next.z - prev.z;
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl;
      tz /= tl;
      if (i > 0) travelled += path[i].distanceTo(path[i - 1]);

      // Across-track axis in plan view. The ruts and the braid offset both ride
      // it, and a metre of slow wander is what stops the line reading as
      // surveyed rather than driven.
      const ax = -tz;
      const az = tx;
      const wander = wobble(travelled, seed) * 1.6;
      const lateral = offset + wander + side * (TRACK_GAUGE / 2);

      const cx = path[i].x + ax * lateral;
      const cz = path[i].z + az * lateral;
      const cy = heightAt(cx, cz) + LIFT;

      positions.push(cx - ax * HALF_WIDTH, cy, cz - az * HALF_WIDTH);
      positions.push(cx + ax * HALF_WIDTH, cy, cz + az * HALF_WIDTH);

      // Wear varies along the route: the wind scours some stretches back to
      // nothing and leaves others sharp, which is what an old track looks like
      // and also, usefully, keeps it from being a continuous guide rail.
      const patchy = 0.55 + 0.45 * wobble(travelled * 1.7, seed + 4.1);
      // Both ends taper out rather than stopping dead — a track that begins in
      // the middle of open sand is a graphic, not a track.
      const fromEnd = Math.min(travelled, 40) / 40;
      const toEnd = Math.min(path.length * STEP - travelled, 40) / 40;
      const a = 0.19 * traffic * Math.max(0, patchy) * fromEnd * Math.max(0, toEnd);
      alphas.push(a, a);
    }

    for (let i = 0; i + 1 < path.length; i++) {
      const v = start + i * 2;
      indices.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
    }
  }
}
