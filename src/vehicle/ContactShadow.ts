import * as THREE from 'three';
import type { WheelState } from './Vehicle';

/**
 * A soft darkening patch pinned to the ground beneath the truck.
 *
 * The sun's cast shadow can't do this job on its own: at the golden-hour angles
 * this game lives in, it lands several metres to the side, so nothing sits
 * directly under the vehicle and the eye reads it as hovering. This is the
 * ambient-occlusion contact patch that grounds it.
 *
 * It is driven by actual wheel contact and fades out when the truck is airborne,
 * so it doubles as the clearest possible signal of the moment you leave and
 * rejoin the ground.
 */
const WIDTH = 2.7;
const LENGTH = 5.4;
/**
 * Footprint scale for a two-wheeler.
 *
 * The oval is sized for a 4x4 and the bike inherited it, so a 0.9m-wide
 * motorcycle sat on a 2.7m patch of shade — the same fixed-footprint problem
 * that gave it a car's tyre tracks and a car's dust cloud.
 */
const BIKE_SCALE = { x: 0.4, z: 0.45 };
/** Lifted along the ground normal to stay off the terrain's own triangles. */
const LIFT = 0.05;

// Falloff is derived from the geometry's own local position rather than `uv`,
// so it cannot silently degrade into a hard-edged rectangle if the uv attribute
// isn't where the shader expects it.
const VERTEX = /* glsl */ `
  uniform vec2 uHalfExtent;
  varying vec2 vLocal;
  void main() {
    vLocal = vec2( position.x, position.z ) / uHalfExtent;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vLocal;
  void main() {
    float d = length( vLocal );
    float falloff = 1.0 - smoothstep( 0.15, 1.0, d );
    float a = falloff * uOpacity;
    if ( a <= 0.002 ) discard;
    gl_FragColor = vec4( uColor, a );
  }
`;

export class ContactShadow {
  readonly mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;

  /** Smoothed contact fraction, so the patch fades rather than blinking. */
  private strength = 0;

  private centre = new THREE.Vector3();
  private normal = new THREE.Vector3(0, 1, 0);
  private forward = new THREE.Vector3(0, 0, 1);
  private right = new THREE.Vector3(1, 0, 0);
  private basis = new THREE.Matrix4();

  constructor() {
    const geo = new THREE.PlaneGeometry(WIDTH, LENGTH);
    // Plane is authored in XY; lay it flat so +Y is its normal and +Z its length.
    geo.rotateX(-Math.PI / 2);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(0x2e2a45) },
        uOpacity: { value: 0 },
        uHalfExtent: { value: new THREE.Vector2(WIDTH / 2, LENGTH / 2) },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      // Straight alpha over the ground. Multiply blending would tint more
      // naturally but is easy to get silently wrong, and at these opacities the
      // difference isn't worth the risk.
      transparent: true,
      depthWrite: false,
      fog: false,
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = 1;
  }

  update(
    wheels: WheelState[],
    bodyQuat: THREE.Quaternion,
    dt: number,
    twoWheeled = false,
  ) {
    // Local x is the plane's width and local y its length, before the quaternion
    // below lays it on the ground.
    this.mesh.scale.set(
      twoWheeled ? BIKE_SCALE.x : 1,
      twoWheeled ? BIKE_SCALE.z : 1,
      1,
    );
    const grounded = wheels.filter((w) => w.contact);
    const target = grounded.length / Math.max(1, wheels.length);

    // Fade out faster than in: leaving the ground should read instantly, landing
    // should settle. Both are eased so a wheel chattering over a ripple doesn't
    // make the patch strobe.
    const rate = target > this.strength ? 9 : 14;
    this.strength += (target - this.strength) * (1 - Math.exp(-rate * dt));

    (this.material.uniforms.uOpacity.value as number) = this.strength * 0.6;

    if (this.strength < 0.01) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;

    // Sit on the average contact point so the patch tracks the wheels up and
    // over terrain rather than the body's own bobbing.
    if (grounded.length > 0) {
      this.centre.set(0, 0, 0);
      this.normal.set(0, 0, 0);
      for (const w of grounded) {
        this.centre.x += w.contactX;
        this.centre.y += w.contactY;
        this.centre.z += w.contactZ;
        this.normal.x += w.normalX;
        this.normal.y += w.normalY;
        this.normal.z += w.normalZ;
      }
      this.centre.divideScalar(grounded.length);
      if (this.normal.lengthSq() < 1e-6) this.normal.set(0, 1, 0);
      this.normal.normalize();
    }

    // Orient to the ground, but keep the truck's heading so the oval lies along
    // the vehicle rather than spinning with the slope.
    this.forward.set(0, 0, 1).applyQuaternion(bodyQuat);
    this.right.crossVectors(this.forward, this.normal);
    if (this.right.lengthSq() < 1e-6) this.right.set(1, 0, 0);
    this.right.normalize();
    this.forward.crossVectors(this.normal, this.right).normalize();

    this.basis.makeBasis(this.right, this.normal, this.forward);
    this.basis.setPosition(
      this.centre.x + this.normal.x * LIFT,
      this.centre.y + this.normal.y * LIFT,
      this.centre.z + this.normal.z * LIFT,
    );
    this.mesh.matrix.copy(this.basis);
    this.mesh.matrixWorldNeedsUpdate = true;
  }
}
