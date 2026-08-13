import * as THREE from 'three';
import type { WheelState } from './Vehicle';
import { emptyWheelState, mergeAxle } from './twoWheeled';

/**
 * Tyre tracks pressed into the sand.
 *
 * Dust says "touching right now"; the contact patch says "touching here". This
 * is the third leg: persistent evidence of where the truck has actually been.
 * It's also what makes a dune feel like a surface you're working across rather
 * than a backdrop sliding past.
 *
 * A ribbon per side, laid down from the rear wheel contact points — front and
 * rear wheels track the same line on a 4x4, so two ribbons is what you'd
 * actually see.
 */
/**
 * Segments per ribbon. This, not FADE_TIME, is what actually sets how much of
 * your drive you can look back on: at 90kph the old 240-segment budget was
 * spent in five seconds of driving, so the tail was being recycled long before
 * anything had a chance to fade. 700 at the step below is about 560m of history
 * per ribbon — far enough back to see the line you took over the last dune.
 */
const MAX_SEGMENTS = 700;
const TRACK_HALF_WIDTH = 0.19;
/** Minimum travel before a new segment is laid, in metres. */
const MIN_STEP = 0.8;
/**
 * Travel beyond which a frame's movement can't be driving — it's a teleport
 * (boundary respawn, recovery). Connecting across one would streak a single
 * segment across the whole world, so the ribbon breaks and restarts instead.
 */
const TELEPORT_BREAK = 12;
/**
 * Seconds before a track has faded completely.
 *
 * Sand fills a rut over hours, not seconds. Twenty-two seconds meant a track
 * was gone before you had finished the dune you made it on, which quietly
 * undercut the one thing tracks are for — coming back over your own line and
 * recognising it. Long enough now that the segment budget above is what
 * expires a track in normal driving, and the timer only takes over when you
 * stop and sit somewhere.
 */
const FADE_TIME = 210;
const LIFT = 0.04;
const RIBBONS = 2;

interface Segment {
  ax: number; ay: number; az: number;
  bx: number; by: number; bz: number;
  age: number;
  /** First segment after a ribbon break (takeoff, teleport) — no quad joins
      it to its predecessor, or the join renders as a sliver across the gap. */
  head: boolean;
}

const VERTEX = /* glsl */ `
  attribute float aAlpha;
  varying float vAlpha;
  void main() {
    vAlpha = aAlpha;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    if ( vAlpha <= 0.003 ) discard;
    gl_FragColor = vec4( uColor, vAlpha );
  }
`;

export class TrackSystem {
  readonly mesh: THREE.Mesh;

  private segments: Segment[][] = [[], []];
  private lastPos: Array<{ x: number; z: number } | null> = [null, null];
  /** Set on a break; consumed by the next pushed segment as its head flag. */
  private headNext: boolean[] = [true, true];
  private positions = new Float32Array(RIBBONS * MAX_SEGMENTS * 2 * 3);
  private alphas = new Float32Array(RIBBONS * MAX_SEGMENTS * 2);
  private indices = new Uint16Array(RIBBONS * (MAX_SEGMENTS - 1) * 6);
  private geometry: THREE.BufferGeometry;
  private material: THREE.ShaderMaterial;
  private indexCount = 0;

  constructor() {
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1));
    this.geometry.setIndex(new THREE.BufferAttribute(this.indices, 1));
    this.geometry.setDrawRange(0, 0);
    // Tracks span wherever the player has driven, so a bounding sphere would be
    // wrong the moment they move; culling is not worth the bookkeeping here.
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);

    this.material = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0x8a6844) } },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      // Ribbons twist over rolling dunes; double-sided avoids any chance of a
      // segment vanishing because it happened to face away.
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  /**
   * @param rearIndices the two rear wheels, in left/right order
   * @param single      lay one centred ribbon instead of two.
   *
   * A bike leaves one line. The physics gives every body four raycasts at the
   * shared hard-points, so without this the motorcycle laid a 4x4's pair of
   * parallel ruts a track-width apart — which is the single most obvious way a
   * two-wheeler can look wrong from behind.
   */
  update(
    wheels: WheelState[],
    rearIndices: [number, number],
    dt: number,
    single = false,
  ) {
    const ribbons = single ? 1 : RIBBONS;
    for (let r = 0; r < ribbons; r++) {
      // Centred: the midpoint of the two rear raycasts is where the bike's
      // single contact patch actually is.
      const w = single
        ? mergeAxle(wheels[rearIndices[0]], wheels[rearIndices[1]], this.mid)
        : wheels[rearIndices[r]];
      if (!w?.contact) {
        // Break the ribbon on takeoff so the track doesn't stretch across a jump.
        this.lastPos[r] = null;
        this.headNext[r] = true;
        continue;
      }

      const last = this.lastPos[r];
      const moved = last
        ? Math.hypot(w.contactX - last.x, w.contactZ - last.z)
        : Infinity;

      if (moved > TELEPORT_BREAK) {
        this.lastPos[r] = { x: w.contactX, z: w.contactZ };
        this.headNext[r] = true;
        continue;
      }
      if (moved >= MIN_STEP) {
        if (last) this.pushSegment(r, w, last);
        this.lastPos[r] = { x: w.contactX, z: w.contactZ };
      }
    }

    // Whichever ribbons aren't in use must be broken, or switching to the bike
    // mid-drive leaves ribbon 1 joined across the gap to wherever it left off.
    for (let r = ribbons; r < RIBBONS; r++) {
      this.lastPos[r] = null;
      this.headNext[r] = true;
    }

    this.ageAndUpload(dt);
  }

  /** Scratch for the merged bike contact, so `update` allocates nothing. */
  private mid: WheelState = emptyWheelState();

  private pushSegment(r: number, w: WheelState, last: { x: number; z: number }) {
    // Lay the segment across the direction of travel, in the ground plane.
    let dx = w.contactX - last.x;
    let dz = w.contactZ - last.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;

    // right = travel x normal, giving an across-track axis that lies in the
    // ground plane, so the ribbon stays flat on a banked dune face.
    // travel = (dx, 0, dz), so the zero y-component collapses several terms.
    const nx = w.normalX;
    const ny = w.normalY;
    const nz = w.normalZ;
    let rx = -dz * ny;
    let ry = dz * nx - dx * nz;
    let rz = dx * ny;
    const rl = Math.hypot(rx, ry, rz) || 1;
    rx /= rl;
    ry /= rl;
    rz /= rl;

    const list = this.segments[r];
    const head = this.headNext[r];
    this.headNext[r] = false;
    list.push({
      head,
      ax: w.contactX - rx * TRACK_HALF_WIDTH + nx * LIFT,
      ay: w.contactY - ry * TRACK_HALF_WIDTH + ny * LIFT,
      az: w.contactZ - rz * TRACK_HALF_WIDTH + nz * LIFT,
      bx: w.contactX + rx * TRACK_HALF_WIDTH + nx * LIFT,
      by: w.contactY + ry * TRACK_HALF_WIDTH + ny * LIFT,
      bz: w.contactZ + rz * TRACK_HALF_WIDTH + nz * LIFT,
      age: 0,
    });
    if (list.length > MAX_SEGMENTS) list.shift();
  }

  private ageAndUpload(dt: number) {
    let write = 0;
    let idx = 0;
    let anyAlive = false;

    for (let r = 0; r < RIBBONS; r++) {
      const list = this.segments[r];
      const base = r * MAX_SEGMENTS * 2;
      let kept = 0;
      const keptSegs: Segment[] = [];

      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        s.age += dt;
        if (s.age >= FADE_TIME) continue;
        anyAlive = true;
        keptSegs.push(s);

        const v = base + kept * 2;
        this.positions[v * 3] = s.ax;
        this.positions[v * 3 + 1] = s.ay;
        this.positions[v * 3 + 2] = s.az;
        this.positions[(v + 1) * 3] = s.bx;
        this.positions[(v + 1) * 3 + 1] = s.by;
        this.positions[(v + 1) * 3 + 2] = s.bz;

        // Hold opacity most of the life, then fade — sand fills a rut slowly.
        const t = s.age / FADE_TIME;
        const a = 0.4 * (1 - t * t * t);
        this.alphas[v] = a;
        this.alphas[v + 1] = a;
        kept++;
      }

      // Drop fully-faded segments from the front of the list.
      if (kept < list.length) list.splice(0, list.length - kept);

      for (let i = 0; i + 1 < kept; i++) {
        // Never join across a ribbon break: the segment after a jump or a
        // teleport starts a fresh strip.
        if (keptSegs[i + 1].head) continue;
        const a = base + i * 2;
        this.indices[idx++] = a;
        this.indices[idx++] = a + 1;
        this.indices[idx++] = a + 2;
        this.indices[idx++] = a + 1;
        this.indices[idx++] = a + 3;
        this.indices[idx++] = a + 2;
      }
      write += kept;
    }

    if (write === 0 && !anyAlive) {
      this.geometry.setDrawRange(0, 0);
      return;
    }

    this.indexCount = idx;
    this.geometry.setDrawRange(0, this.indexCount);
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aAlpha.needsUpdate = true;
    if (this.geometry.index) this.geometry.index.needsUpdate = true;
  }

  /** Wipes every track — used when the truck is teleported or recovered. */
  clear() {
    this.segments = [[], []];
    this.lastPos = [null, null];
    this.headNext = [true, true];
    this.geometry.setDrawRange(0, 0);
  }
}
