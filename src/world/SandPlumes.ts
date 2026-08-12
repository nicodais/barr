import * as THREE from 'three';
import { WIND_X, WIND_Z, crestNear } from '../terrain/height';

/**
 * Sand streaming off the dune crests.
 *
 * When the shamal is up, every brink in the region smokes: the wind drives sand
 * up the windward face, it goes over the top, and it hangs there in a wisp
 * before falling down the slip face. It is the most characteristic thing the
 * Emirati desert does, and it costs almost nothing to draw — which makes it the
 * best value of any single effect in this project.
 *
 * It also does real work beyond looking right. The plumes mark out where the
 * crest lines are from a long way off, which is exactly the information a driver
 * wants when picking a line: a smoking ridge is telling you where the ground
 * falls away. And because emission is gated on the same wind strength that
 * drives the sky's haze, the world gets visibly windier through the afternoon
 * and settles at dusk without anyone scripting weather.
 *
 * Billboarded point sprites, one draw call, no texture — same approach as
 * DustSystem (§4, §8).
 */
const MAX_PARTICLES = 260;

/** Ring around the player that crests are sampled from, metres. */
const NEAR = 30;
const FAR = 260;

/** A crest flatter than this isn't a brink and doesn't stream. */
const MIN_AMP = 8;
/** Packed sand and gravel have nothing loose to give up. */
const MIN_SOFTNESS = 0.42;

/** Gusts started per second at full wind, before the particle budget bites. */
const GUSTS_PER_SECOND = 13;

const VERTEX = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  varying float vAlpha;
  void main() {
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4( position, 1.0 );
    gl_PointSize = min( aSize * ( 320.0 / max( -mv.z, 0.1 ) ), 210.0 );
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
    // Softer-edged than wheel dust: this is a thin veil seen at distance, not a
    // puff thrown a metre from the camera.
    float a = smoothstep( 0.5, 0.0, d ) * vAlpha;
    if ( a <= 0.001 ) discard;
    gl_FragColor = vec4( uColor, a );
  }
`;

export class SandPlumes {
  readonly points: THREE.Points;

  private positions = new Float32Array(MAX_PARTICLES * 3);
  private sizes = new Float32Array(MAX_PARTICLES);
  private alphas = new Float32Array(MAX_PARTICLES);
  private velocities = new Float32Array(MAX_PARTICLES * 3);
  private ages = new Float32Array(MAX_PARTICLES);
  private lifetimes = new Float32Array(MAX_PARTICLES);
  private cursor = 0;
  private activeLimit = MAX_PARTICLES;
  /** Fractional gust emission carried between frames. */
  private budget = 0;
  /**
   * 0..1 storm term. The wind value alone already maxes out during a shamal, so
   * without this the difference between "breezy afternoon" and "storm" is a
   * handful more wisps two hundred metres away. This is what brings the sand in
   * close and makes it something you're driving *through*.
   */
  private storm = 0;
  private dirty = false;

  private geometry: THREE.BufferGeometry;
  private material: THREE.ShaderMaterial;

  constructor() {
    // Park unused particles far below the world rather than at the origin,
    // where they'd sit as a permanent smudge on the spawn pan.
    for (let i = 0; i < MAX_PARTICLES; i++) this.positions[i * 3 + 1] = -10000;

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
    this.geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1));
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);

    this.material = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0xd9a273) } },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    // Under the wheel dust: a plume two hundred metres away has no business
    // drawing over sand the truck is throwing up right now.
    this.points.renderOrder = 9;
  }

  /** Tints the sand with the current light, as the wheel dust does. */
  setColor(color: THREE.Color) {
    (this.material.uniforms.uColor.value as THREE.Color).copy(color);
  }

  /** @param k 0..1 shamal intensity, from Weather. */
  setStorm(k: number) {
    this.storm = k < 0 ? 0 : k > 1 ? 1 : k;
  }

  setMaxParticles(n: number) {
    this.activeLimit = Math.max(0, Math.min(MAX_PARTICLES, Math.floor(n)));
    if (this.cursor >= this.activeLimit) this.cursor = 0;
  }

  /**
   * @param wind 0..1 wind strength — shared with the sky's haze so the two
   *             always agree about how rough the weather is.
   */
  update(dt: number, x: number, z: number, wind: number) {
    if (this.activeLimit > 0 && wind > 0.02) {
      this.budget += GUSTS_PER_SECOND * wind * dt;
      // Capped per frame so a long frame can't spend the whole pool at once and
      // blink every existing plume out of the world.
      let allowed = 3;
      while (this.budget >= 1 && allowed-- > 0) {
        this.budget -= 1;
        this.emitGust(x, z, wind);
      }
      if (this.budget > 3) this.budget = 3;
    }
    this.step(dt);
  }

  /**
   * One wisp lifting off one brink.
   *
   * The crest is found by projection rather than search — `crestNear` solves for
   * it in closed form — so this can afford to throw away the misses (flat ground,
   * hardpack, gravel) without a fallback loop.
   */
  private emitGust(px: number, pz: number, wind: number) {
    const angle = Math.random() * Math.PI * 2;
    // In a storm the ring closes right in — sand streams past the windscreen,
    // not just off the ridge line on the horizon.
    const near = NEAR * (1 - 0.78 * this.storm);
    const radius = near + Math.random() * (FAR - near);
    const crest = crestNear(px + Math.cos(angle) * radius, pz + Math.sin(angle) * radius);
    // And smaller features start giving sand up too: in a real shamal every
    // ripple crest is moving, not only the big brinks.
    if (crest.amp < MIN_AMP * (1 - 0.65 * this.storm) || crest.softness < MIN_SOFTNESS) return;

    // How willing this brink is to give sand up at all.
    const strength = wind * Math.min(1, (crest.amp - MIN_AMP) / 10) * crest.softness;
    if (strength < 0.05) return;

    // Spread along the crest line, not across it: a gust lifts off a length of
    // ridge at once, which is what makes it read as a ribbon rather than a puff.
    const tangentX = -WIND_Z;
    const tangentZ = WIND_X;
    const count = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < count; i++) {
      const t = (Math.random() - 0.5) * 14;
      // Staggered downwind so the ribbon is already strung out when it appears.
      const lead = Math.random() * 4;
      this.spawn(
        crest.x + tangentX * t + WIND_X * lead,
        crest.y + 0.3 + Math.random() * 0.8,
        crest.z + tangentZ * t + WIND_Z * lead,
        strength,
      );
    }
  }

  private spawn(x: number, y: number, z: number, strength: number) {
    if (this.activeLimit <= 0) return;
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.activeLimit;

    this.positions[i * 3] = x;
    this.positions[i * 3 + 1] = y;
    this.positions[i * 3 + 2] = z;

    // Carried downwind, with just enough lift to clear the brink before it
    // starts falling down the slip face behind it.
    const speed = 3.4 + Math.random() * 4.6 * strength;
    this.velocities[i * 3] = WIND_X * speed + (Math.random() - 0.5) * 1.1;
    this.velocities[i * 3 + 1] = 0.35 + Math.random() * 0.9;
    this.velocities[i * 3 + 2] = WIND_Z * speed + (Math.random() - 0.5) * 1.1;

    this.ages[i] = 0;
    this.lifetimes[i] = 1.6 + Math.random() * 1.9;
    this.sizes[i] = 1.4 + Math.random() * 1.8;
    // Deliberately faint. A plume you notice individually is a smoke machine;
    // the effect wants to be something you only see because the ridge line has
    // gone soft at the top.
    this.alphas[i] = (0.05 + strength * 0.11) * (1 + 1.7 * this.storm);
    this.dirty = true;
  }

  private step(dt: number) {
    let alive = false;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.lifetimes[i] <= 0) continue;

      this.ages[i] += dt;
      if (this.ages[i] >= this.lifetimes[i]) {
        this.lifetimes[i] = 0;
        this.alphas[i] = 0;
        this.positions[i * 3 + 1] = -10000;
        continue;
      }
      alive = true;

      // Settles rather than falls — this is the fraction fine enough to have
      // been lifted in the first place, so it hangs.
      this.velocities[i * 3 + 1] -= 1.1 * dt;
      // Much less drag than wheel dust: it's riding the wind, not fighting it.
      const drag = Math.exp(-0.55 * dt);
      this.velocities[i * 3] *= drag;
      this.velocities[i * 3 + 1] *= drag;
      this.velocities[i * 3 + 2] *= drag;

      this.positions[i * 3] += this.velocities[i * 3] * dt;
      this.positions[i * 3 + 1] += this.velocities[i * 3 + 1] * dt;
      this.positions[i * 3 + 2] += this.velocities[i * 3 + 2] * dt;

      this.sizes[i] += dt * 2.4;
      this.alphas[i] *= Math.exp(-1.15 * dt);
    }

    if (alive || this.dirty) {
      this.geometry.attributes.position.needsUpdate = true;
      this.geometry.attributes.aSize.needsUpdate = true;
      this.geometry.attributes.aAlpha.needsUpdate = true;
    }
    this.dirty = alive;
  }
}

/**
 * Wind strength from the sky's haze.
 *
 * One curve drives both, because they have one cause: the shamal picks the dust
 * up and blows the crests off at the same time. Deriving the wind from the haze
 * rather than authoring a second curve means they can never drift apart into a
 * still afternoon with a brown sky, or a clear morning with the ridges smoking.
 */
export function windFromHaze(haze: number): number {
  const t = (haze - 0.14) / 0.42;
  return t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t);
}
