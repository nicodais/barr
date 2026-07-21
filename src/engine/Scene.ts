import * as THREE from 'three';
import { Sky } from './Sky';
import type { SkyState } from './TimeOfDay';
import type { QualityProfile } from './Quality';

/**
 * three.js moved to physically-based light units in r155: the Lambert BRDF
 * divides by PI and light intensity is no longer pre-multiplied by it, so an
 * intensity of 2.5 lands about 3x darker than the same number used to. The
 * TimeOfDay keyframes stay authored in intuitive "1.0 = normal daylight" units
 * and get scaled here, at the one point where they meet an actual three light.
 * The sky shader deliberately uses the unscaled value for its glow.
 */
const LIGHT_SCALE = Math.PI;

/**
 * Half-width of the sun's shadow frustum, in metres, around the player. Kept
 * tight: this is 2048 texels wide whatever we choose, so doubling the extent
 * halves the resolution of the only shadow that matters — the truck's own.
 */
const SHADOW_EXTENT = 55;
/** How far up-sun the light sits. Must exceed anything it needs to cast from. */
const SUN_DISTANCE = 220;

export class SceneRig {
  readonly scene = new THREE.Scene();
  readonly renderer: THREE.WebGLRenderer;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly sky = new Sky();

  private fog: THREE.Fog;
  private sunDir = new THREE.Vector3();
  private maxPixelRatio = 2;
  private shadowsAllowed = true;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.fog = new THREE.Fog(0xe8b98a, 180, 950);
    this.scene.fog = this.fog;
    this.scene.add(this.sky.mesh);

    this.sun = new THREE.DirectionalLight(0xffd9a8, 2.5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = SUN_DISTANCE * 2;
    this.sun.shadow.camera.left = -SHADOW_EXTENT;
    this.sun.shadow.camera.right = SHADOW_EXTENT;
    this.sun.shadow.camera.top = SHADOW_EXTENT;
    this.sun.shadow.camera.bottom = -SHADOW_EXTENT;
    this.sun.shadow.bias = -0.0006;
    // Was 0.6, which pushed the shadow lookup 60cm along the surface normal and
    // visibly detached the truck's shadow from the truck — a direct contributor
    // to it reading as hovering.
    this.sun.shadow.normalBias = 0.08;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    // The cool sky term is what puts indigo in the shadows rather than just
    // darkening the sand — the single biggest lever on the Firewatch look (§4).
    this.hemi = new THREE.HemisphereLight(0x89a6d6, 0xb08355, 1.05);
    this.scene.add(this.hemi);
  }

  /**
   * @param focus  where the player is — the shadow frustum and sky dome follow
   *               it, because a shadow map covering the whole region would be
   *               too coarse to resolve the truck at all.
   */
  update(state: SkyState, sunDirection: THREE.Vector3, focus: THREE.Vector3, camera: THREE.Vector3) {
    this.sunDir.copy(sunDirection);

    this.sun.color.copy(state.sunColor);
    this.sun.intensity = state.sunIntensity * LIGHT_SCALE;
    this.sun.position.copy(focus).addScaledVector(this.sunDir, SUN_DISTANCE);
    this.sun.target.position.copy(focus);
    this.sun.target.updateMatrixWorld();
    // Once the sun is under the horizon its shadows are meaningless and start
    // stretching into artefacts, so stop casting rather than fight them.
    this.sun.castShadow = this.shadowsAllowed && this.sunDir.y > 0.03;

    this.hemi.color.copy(state.hemiSky);
    this.hemi.groundColor.copy(state.hemiGround);
    this.hemi.intensity = state.hemiIntensity * LIGHT_SCALE;

    this.fog.color.copy(state.fog);
    this.fog.near = state.fogNear;
    this.fog.far = state.fogFar;

    this.sky.update(state, this.sunDir, camera);
  }

  setSize(width: number, height: number) {
    this.renderer.setSize(width, height, false);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.maxPixelRatio));
  }

  applyQuality(profile: QualityProfile) {
    this.maxPixelRatio = profile.maxPixelRatio;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, profile.maxPixelRatio));

    this.renderer.shadowMap.enabled = profile.shadows;
    this.shadowsAllowed = profile.shadows;

    if (this.sun.shadow.mapSize.width !== profile.shadowMapSize) {
      this.sun.shadow.mapSize.set(profile.shadowMapSize, profile.shadowMapSize);
      // The map is allocated lazily from mapSize, so the old one has to be
      // released or the new size is silently ignored.
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null as unknown as THREE.WebGLRenderTarget;
    }
  }
}
