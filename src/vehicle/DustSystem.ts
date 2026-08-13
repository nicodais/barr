import * as THREE from 'three';
import type { WheelState } from './Vehicle';
import { emptyWheelState, mergeAxle } from './twoWheeled';

/**
 * Sand kicked up at the wheel contact points.
 *
 * This exists for feedback, not decoration: without it the truck has no visible
 * evidence it is touching anything, which reads as floating no matter how
 * correct the physics underneath are. Emission is driven by the *contact point*
 * of each wheel, so dust appears exactly where rubber meets sand and stops dead
 * the instant the truck leaves the ground.
 *
 * Billboarded point sprites rather than a particle sim (§4), one draw call, and
 * the round shape comes from `gl_PointCoord` so there's no texture to download.
 */
const MAX_PARTICLES = 320;
/** Below this there's no meaningful spray, just idling. */
const MIN_SPEED = 2.2;

const VERTEX = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  varying float vAlpha;
  void main() {
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4( position, 1.0 );
    // Perspective size attenuation, clamped so near particles can't swallow
    // the screen when the camera dips close to the ground.
    gl_PointSize = min( aSize * ( 320.0 / max( -mv.z, 0.1 ) ), 190.0 );
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
    // Soft edge; the puff is denser in the middle.
    float a = smoothstep( 0.5, 0.08, d ) * vAlpha;
    if ( a <= 0.001 ) discard;
    gl_FragColor = vec4( uColor, a );
  }
`;

export class DustSystem {
  readonly points: THREE.Points;

  private positions = new Float32Array(MAX_PARTICLES * 3);
  private sizes = new Float32Array(MAX_PARTICLES);
  private alphas = new Float32Array(MAX_PARTICLES);
  private velocities = new Float32Array(MAX_PARTICLES * 3);
  private ages = new Float32Array(MAX_PARTICLES);
  private lifetimes = new Float32Array(MAX_PARTICLES);
  private cursor = 0;
  /**
   * How much of the pool the current quality tier is allowed to use. The buffers
   * are always allocated at full size — resizing them would mean rebuilding the
   * geometry mid-drive — so a lower tier simply wraps the ring sooner and lets
   * the surplus particles finish their lives and stay parked.
   */
  private activeLimit = MAX_PARTICLES;
  /** Fractional emission carried between frames so slow speeds still emit. */
  private budget = 0;

  private geometry: THREE.BufferGeometry;
  private material: THREE.ShaderMaterial;

  constructor() {
    this.lifetimes.fill(0);
    this.alphas.fill(0);
    // Park unused particles far below the world rather than at the origin,
    // where they'd otherwise sit as a permanent smudge on the spawn pan.
    for (let i = 0; i < MAX_PARTICLES; i++) this.positions[i * 3 + 1] = -10000;

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
    this.geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1));
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);

    this.material = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0xe8c9a0) } },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      // Dust must not occlude itself or the truck.
      depthWrite: false,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }

  /** Tints the dust with the current light so it doesn't glow at dusk. */
  setColor(color: THREE.Color) {
    (this.material.uniforms.uColor.value as THREE.Color).copy(color);
  }

  setMaxParticles(n: number) {
    this.activeLimit = Math.max(16, Math.min(MAX_PARTICLES, Math.floor(n)));
    if (this.cursor >= this.activeLimit) this.cursor = 0;
  }

  /**
   * @param speed  vehicle ground speed, m/s
   * @param impact 0..1 landing severity, for a burst on touchdown
   */
  /**
   * @param single the body runs on two wheels, so merge each axle onto the
   *   centre line first. Without it the bike sprays sand from four points a
   *   pickup's track apart, which is as wide as the cloud behind the pickup.
   */
  emitFromWheels(
    wheels: WheelState[],
    speed: number,
    dt: number,
    impact = 0,
    single = false,
  ) {
    let source = wheels;
    if (single) {
      mergeAxle(wheels[0], wheels[1], this.axleFront);
      mergeAxle(wheels[2], wheels[3], this.axleRear);
      source = this.axlePair;
    }
    const grounded = source.filter((w) => w.contact);
    if (grounded.length === 0) return;

    if (speed > MIN_SPEED) {
      // Loose sand sprays far more than hardpack, which makes the traction
      // model legible at a glance instead of only through the HUD.
      const meanSoftness =
        grounded.reduce((sum, w) => sum + w.softness, 0) / grounded.length;
      const rate = (speed - MIN_SPEED) * (2.2 + meanSoftness * 9) * grounded.length;
      this.budget += rate * dt;

      while (this.budget >= 1) {
        this.budget -= 1;
        const w = grounded[(Math.random() * grounded.length) | 0];
        this.spawn(w, speed, w.softness, 1);
      }
    }

    if (impact > 0.02) {
      const burst = Math.min(26, Math.round(impact * 26));
      for (let i = 0; i < burst; i++) {
        const w = grounded[(Math.random() * grounded.length) | 0];
        this.spawn(w, speed, w.softness, 1.7 + impact);
      }
    }
  }

  /** Scratch for the merged two-wheeler axles; reused, never reallocated. */
  private axleFront = emptyWheelState();
  private axleRear = emptyWheelState();
  private axlePair = [this.axleFront, this.axleRear];

  private spawn(w: WheelState, speed: number, softness: number, scale: number) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.activeLimit;

    const spread = 0.28;
    this.positions[i * 3] = w.contactX + (Math.random() - 0.5) * spread;
    this.positions[i * 3 + 1] = w.contactY + 0.08;
    this.positions[i * 3 + 2] = w.contactZ + (Math.random() - 0.5) * spread;

    // Thrown up along the ground normal, with a random lateral kick. Deliberately
    // not thrown backwards along travel: sand billows and hangs, it doesn't jet.
    const lift = (0.7 + Math.random() * 1.3) * (0.5 + softness);
    this.velocities[i * 3] = (Math.random() - 0.5) * 1.7 + w.normalX * lift;
    this.velocities[i * 3 + 1] = w.normalY * lift + 0.4;
    this.velocities[i * 3 + 2] = (Math.random() - 0.5) * 1.7 + w.normalZ * lift;

    this.ages[i] = 0;
    this.lifetimes[i] = (0.55 + Math.random() * 0.7) * scale;
    this.sizes[i] = (0.5 + Math.random() * 0.6 + speed * 0.02) * scale;
    this.alphas[i] = Math.min(0.6, (0.16 + softness * 0.42) * scale);
  }

  update(dt: number) {
    let alive = false;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.lifetimes[i] <= 0) continue;

      this.ages[i] += dt;
      const t = this.ages[i] / this.lifetimes[i];
      if (t >= 1) {
        this.lifetimes[i] = 0;
        this.alphas[i] = 0;
        this.positions[i * 3 + 1] = -10000;
        continue;
      }
      alive = true;

      // Settle back down and slow, like sand hanging in still air.
      this.velocities[i * 3 + 1] -= 1.6 * dt;
      const drag = Math.exp(-2.1 * dt);
      this.velocities[i * 3] *= drag;
      this.velocities[i * 3 + 1] *= drag;
      this.velocities[i * 3 + 2] *= drag;

      this.positions[i * 3] += this.velocities[i * 3] * dt;
      this.positions[i * 3 + 1] += this.velocities[i * 3 + 1] * dt;
      this.positions[i * 3 + 2] += this.velocities[i * 3 + 2] * dt;

      // Grow as it disperses, fade out over the back half of its life.
      this.sizes[i] += dt * 1.5;
      this.alphas[i] *= Math.exp(-2.3 * dt);
    }

    if (alive || this.dirty) {
      this.geometry.attributes.position.needsUpdate = true;
      this.geometry.attributes.aSize.needsUpdate = true;
      this.geometry.attributes.aAlpha.needsUpdate = true;
    }
    this.dirty = alive;
  }

  private dirty = false;
}
