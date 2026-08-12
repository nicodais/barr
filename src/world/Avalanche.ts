import * as THREE from 'three';
import type { WheelState } from '../vehicle/Vehicle';

/**
 * Sand sloughing down a slip face under the wheels.
 *
 * This is the one thing a dune does that nothing else in the world does, and
 * the one moment of dune bashing that has no visual at all until you build it:
 * you break over a brink onto a face standing at the angle of repose, the
 * surface lets go, and a sheet of sand runs out ahead of you all the way to the
 * bottom. It is also the clearest read the player gets that this face is
 * *steep* — steeper than the shading alone communicates — which is exactly the
 * information that makes committing to a descent feel like a decision.
 *
 * Grains are constrained to the plane of the face they were shed from rather
 * than resampled against the height field. A slip face is planar by definition
 * (it is at repose everywhere, that's what makes it a slip face), so over the
 * few metres a grain travels the plane *is* the terrain, and the version that
 * costs 200 `heightAt` calls a frame buys nothing for it.
 *
 * Billboarded points, one draw call, no texture — same as DustSystem (§4, §8).
 */
const MAX_GRAINS = 220;

/**
 * Steepness at which sand starts to let go, as a surface normal's Y component.
 *
 * Set against the slopes the region actually has rather than against the repose
 * angle. The height field solves its slip faces to 33 degrees, but that is the
 * ceiling, not the norm: measured over the whole map the 90th percentile slope
 * is 19 degrees and the 99th is 29. A threshold at 26 — which is where this
 * started — fires on the steepest one percent of the world, and a full descent
 * of a real dune face went by without shedding a grain. 22 degrees catches the
 * faces a driver reads as steep, which is the point.
 */
const MIN_STEEP = Math.cos((22 * Math.PI) / 180);
/** Gravel and hardpack have nothing loose to shed. */
const MIN_SOFTNESS = 0.4;
/** Below this the wheels are settling into the face, not breaking it. */
const MIN_SPEED = 3.5;

/** Grains shed per second per wheel, at full steepness and speed. */
const SHED_RATE = 55;
/**
 * How far past MIN_STEEP shedding reaches full strength, as a change in the
 * normal's Y. Sized so a 33-degree face — the steepest the height field
 * produces — is at full strength and a 29-degree one is at about half.
 */
const STEEP_WINDOW = 0.09;

const GRAVITY = 9.81;

const VERTEX = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  varying float vAlpha;
  void main() {
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4( position, 1.0 );
    gl_PointSize = min( aSize * ( 320.0 / max( -mv.z, 0.1 ) ), 150.0 );
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length( c );
    if ( d > 0.5 ) discard;
    // Harder-edged than airborne dust: this is sand on the ground, moving.
    float a = smoothstep( 0.5, 0.24, d ) * vAlpha;
    if ( a <= 0.001 ) discard;
    gl_FragColor = vec4( uColor, a );
  }
`;

export class Avalanche {
  readonly points: THREE.Points;

  private positions = new Float32Array(MAX_GRAINS * 3);
  private sizes = new Float32Array(MAX_GRAINS);
  private alphas = new Float32Array(MAX_GRAINS);
  private velocities = new Float32Array(MAX_GRAINS * 3);
  /** The face this grain was shed from: a point on it and its normal. */
  private planeOrigin = new Float32Array(MAX_GRAINS * 3);
  private planeNormal = new Float32Array(MAX_GRAINS * 3);
  private ages = new Float32Array(MAX_GRAINS);
  private lifetimes = new Float32Array(MAX_GRAINS);
  /** Set once a grain has run out of momentum and become a deposit. */
  private settled = new Uint8Array(MAX_GRAINS);
  private cursor = 0;
  private activeLimit = MAX_GRAINS;
  private budget = 0;
  private dirty = false;

  private geometry: THREE.BufferGeometry;
  private material: THREE.ShaderMaterial;

  constructor() {
    for (let i = 0; i < MAX_GRAINS; i++) this.positions[i * 3 + 1] = -10000;

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
    this.geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1));
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);

    this.material = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0xc79a6f) } },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    // Under the wheel dust, over the tyre tracks: the running sheet covers the
    // ruts it is burying, and the dust the wheels are throwing covers it.
    this.points.renderOrder = 8;
  }

  setColor(color: THREE.Color) {
    (this.material.uniforms.uColor.value as THREE.Color).copy(color);
  }

  setMaxGrains(n: number) {
    this.activeLimit = Math.max(0, Math.min(MAX_GRAINS, Math.floor(n)));
    if (this.cursor >= this.activeLimit) this.cursor = 0;
  }

  /**
   * @param speed vehicle ground speed, m/s
   */
  update(dt: number, wheels: WheelState[], speed: number) {
    if (this.activeLimit > 0 && speed > MIN_SPEED) {
      for (const w of wheels) {
        if (!w.contact || w.softness < MIN_SOFTNESS) continue;
        if (w.normalY > MIN_STEEP) continue;

        // How far past the letting-go angle this face is, 0..1. Squared so a
        // marginal slope produces a trickle and a true slip face lets go
        // properly — the difference between the two is the whole point.
        const steep = Math.min(1, (MIN_STEEP - w.normalY) / STEEP_WINDOW);
        const drive = Math.min(1, (speed - MIN_SPEED) / 6);
        this.budget += SHED_RATE * steep * steep * drive * w.softness * dt;

        // Capped so a long frame can't spend the entire pool at once and blink
        // every existing grain out of the world.
        let allowed = 14;
        while (this.budget >= 1 && allowed-- > 0) {
          this.budget -= 1;
          this.shed(w, steep);
        }
        if (this.budget > 4) this.budget = 4;
      }
    }
    this.step(dt);
  }

  private shed(w: WheelState, steep: number) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.activeLimit;

    const nx = w.normalX;
    const ny = w.normalY;
    const nz = w.normalZ;

    // Downslope direction: gravity with its surface-normal component removed,
    // which on any tilted plane points straight down the fall line.
    let dx = ny * nx;
    let dy = ny * ny - 1;
    let dz = ny * nz;
    const dl = Math.hypot(dx, dy, dz) || 1;
    dx /= dl;
    dy /= dl;
    dz /= dl;

    // Across-slope axis, for spreading the sheet sideways as it runs.
    const sx = ny * dz - nz * dy;
    const sy = nz * dx - nx * dz;
    const sz = nx * dy - ny * dx;

    const across = (Math.random() - 0.5) * 1.5;
    const ahead = Math.random() * 0.9;
    const px = w.contactX + sx * across + dx * ahead;
    const py = w.contactY + sy * across + dy * ahead + 0.05;
    const pz = w.contactZ + sz * across + dz * ahead;

    this.positions[i * 3] = px;
    this.positions[i * 3 + 1] = py;
    this.positions[i * 3 + 2] = pz;
    this.planeOrigin[i * 3] = px;
    this.planeOrigin[i * 3 + 1] = py;
    this.planeOrigin[i * 3 + 2] = pz;
    this.planeNormal[i * 3] = nx;
    this.planeNormal[i * 3 + 1] = ny;
    this.planeNormal[i * 3 + 2] = nz;

    // Nudged downhill to start; gravity does the rest. Sand doesn't get
    // launched off a slip face, it starts moving and then keeps going.
    const kick = 0.6 + Math.random() * 1.4;
    const drift = (Math.random() - 0.5) * 1.2;
    this.velocities[i * 3] = dx * kick + sx * drift;
    this.velocities[i * 3 + 1] = dy * kick + sy * drift;
    this.velocities[i * 3 + 2] = dz * kick + sz * drift;

    this.ages[i] = 0;
    this.lifetimes[i] = 1.4 + Math.random() * 1.6;
    this.settled[i] = 0;
    this.sizes[i] = 0.5 + Math.random() * 0.7;
    this.alphas[i] = 0.14 + steep * 0.2;
    this.dirty = true;
  }

  private step(dt: number) {
    let alive = false;
    for (let i = 0; i < MAX_GRAINS; i++) {
      if (this.lifetimes[i] <= 0) continue;

      this.ages[i] += dt;
      if (this.ages[i] >= this.lifetimes[i]) {
        this.lifetimes[i] = 0;
        this.alphas[i] = 0;
        this.positions[i * 3 + 1] = -10000;
        continue;
      }
      alive = true;

      if (this.settled[i]) {
        // A deposit at the toe of the run: flattens out and fades as the face
        // above it keeps feeding sand over the top of it.
        this.sizes[i] += dt * 1.1;
        this.alphas[i] *= Math.exp(-0.9 * dt);
        continue;
      }

      const nx = this.planeNormal[i * 3];
      const ny = this.planeNormal[i * 3 + 1];
      const nz = this.planeNormal[i * 3 + 2];

      // Gravity, with the component into the face removed — the ground holds
      // the grain up, so all that's left is the part along the surface.
      const gn = -GRAVITY * ny;
      this.velocities[i * 3] += -gn * nx * dt;
      this.velocities[i * 3 + 1] += (-GRAVITY - gn * ny) * dt;
      this.velocities[i * 3 + 2] += -gn * nz * dt;

      // Friction against the face. This sets the terminal speed of the sheet
      // more than anything else does: at 33 degrees, gravity along the slope is
      // 5.3 m/s^2, so the sheet settles at about 4.4 m/s and reaches the toe of
      // a face rather than trickling a metre and stopping.
      const drag = Math.exp(-1.2 * dt);
      this.velocities[i * 3] *= drag;
      this.velocities[i * 3 + 1] *= drag;
      this.velocities[i * 3 + 2] *= drag;

      let px = this.positions[i * 3] + this.velocities[i * 3] * dt;
      let py = this.positions[i * 3 + 1] + this.velocities[i * 3 + 1] * dt;
      let pz = this.positions[i * 3 + 2] + this.velocities[i * 3 + 2] * dt;

      // Snap back onto the face. Integration error and the drag term both push
      // the grain off the plane, and a grain floating a hand's width above the
      // sand is the exact tell this effect can't afford.
      const off =
        (px - this.planeOrigin[i * 3]) * nx +
        (py - this.planeOrigin[i * 3 + 1]) * ny +
        (pz - this.planeOrigin[i * 3 + 2]) * nz;
      px -= nx * off;
      py -= ny * off;
      pz -= nz * off;

      this.positions[i * 3] = px;
      this.positions[i * 3 + 1] = py;
      this.positions[i * 3 + 2] = pz;

      this.sizes[i] += dt * 0.7;

      // Come to rest, and stay visible where you stopped. Sand that runs down a
      // face doesn't vanish at the bottom — it piles up there, and seeing that
      // pile is half of what tells you the face just moved.
      const v2 =
        this.velocities[i * 3] * this.velocities[i * 3] +
        this.velocities[i * 3 + 1] * this.velocities[i * 3 + 1] +
        this.velocities[i * 3 + 2] * this.velocities[i * 3 + 2];
      if (v2 < 0.36) {
        this.settled[i] = 1;
        // Reset the clock: the deposit outlasts the run that made it.
        this.ages[i] = 0;
        this.lifetimes[i] = 3.5 + Math.random() * 2.5;
      }
    }

    if (alive || this.dirty) {
      this.geometry.attributes.position.needsUpdate = true;
      this.geometry.attributes.aSize.needsUpdate = true;
      this.geometry.attributes.aAlpha.needsUpdate = true;
    }
    this.dirty = alive;
  }
}
