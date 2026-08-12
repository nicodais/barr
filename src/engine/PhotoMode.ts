import * as THREE from 'three';
import { GAME_NAME, GAME_URL_SHORT } from '../brand';
import { minCameraY } from './cameraClearance';

/**
 * Photo mode (§5): free-look camera, a few grades, vignette, and save.
 *
 * The grade is a real post-process pass rather than a CSS filter on the canvas,
 * because a CSS filter is a compositor effect — it looks right on screen and is
 * completely absent from anything you save. Rendering through a fullscreen quad
 * means what you capture is what you framed.
 */
export const FILTERS = ['none', 'golden', 'faded', 'cool', 'noir'] as const;
export type PhotoFilter = (typeof FILTERS)[number];

const FILTER_LABELS: Record<PhotoFilter, string> = {
  none: 'Neutral',
  golden: 'Golden',
  faded: 'Faded',
  cool: 'Blue hour',
  noir: 'Noir',
};

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4( position.xy, 0.0, 1.0 );
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D uScene;
  uniform int uFilter;
  uniform float uVignette;
  varying vec2 vUv;

  vec3 grade( vec3 c, int mode ) {
    if ( mode == 1 ) {           // golden
      // Restrained: the world is already lit at golden hour, so a strong warm
      // grade on top of it just goes orange.
      c *= vec3( 1.05, 1.0, 0.93 );
      c = pow( c, vec3( 0.97, 0.99, 1.03 ) );
    } else if ( mode == 2 ) {    // faded
      c = mix( c, vec3( 0.72, 0.68, 0.63 ), 0.16 );
      c = c * 0.92 + 0.06;
    } else if ( mode == 3 ) {    // cool
      c *= vec3( 0.86, 0.95, 1.18 );
      c = pow( c, vec3( 1.05, 1.0, 0.92 ) );
    } else if ( mode == 4 ) {    // noir
      float l = dot( c, vec3( 0.299, 0.587, 0.114 ) );
      c = vec3( l );
      c = ( c - 0.5 ) * 1.22 + 0.5;
    }
    return c;
  }

  void main() {
    vec3 c = texture2D( uScene, vUv ).rgb;
    c = grade( c, uFilter );
    float d = distance( vUv, vec2( 0.5 ) );
    c *= 1.0 - smoothstep( 0.32, 0.85, d ) * uVignette;
    gl_FragColor = vec4( c, 1.0 );
  }
`;

export class PhotoMode {
  active = false;
  filter: PhotoFilter = 'golden';
  vignette = 0.45;

  private target: THREE.WebGLRenderTarget;
  private quadScene = new THREE.Scene();
  private quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private material: THREE.ShaderMaterial;

  /** Orbit state around the truck. */
  private yaw = 0;
  private pitch = 0.28;
  private distance = 11;
  private dragging = false;
  private lastPointer = { x: 0, y: 0 };
  private focus = new THREE.Vector3();

  constructor(private canvas: HTMLCanvasElement) {
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
    });

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uScene: { value: this.target.texture },
        uFilter: { value: 1 },
        uVignette: { value: this.vignette },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.quadScene.add(quad);

    this.bindPointer();
  }

  static label(filter: PhotoFilter): string {
    return FILTER_LABELS[filter];
  }

  enter(bodyQuat: THREE.Quaternion) {
    this.active = true;
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(bodyQuat);
    this.yaw = Math.atan2(forward.x, forward.z) + Math.PI;
    this.pitch = 0.28;
    this.distance = 11;
  }

  exit() {
    this.active = false;
    this.dragging = false;
  }

  setSize(width: number, height: number, pixelRatio: number) {
    this.target.setSize(
      Math.max(1, Math.floor(width * pixelRatio)),
      Math.max(1, Math.floor(height * pixelRatio)),
    );
  }

  /** Positions the free-look camera around the truck. */
  updateCamera(camera: THREE.PerspectiveCamera, target: THREE.Vector3) {
    this.focus.set(target.x, target.y + 1.1, target.z);
    const cp = Math.cos(this.pitch);
    const x = this.focus.x - Math.sin(this.yaw) * this.distance * cp;
    const z = this.focus.z - Math.cos(this.yaw) * this.distance * cp;
    let y = this.focus.y + Math.sin(this.pitch) * this.distance;

    // Swinging the orbit down to a low angle drives the camera straight into
    // the dune behind the truck, so the same clearance rule applies here.
    // Applied directly rather than eased: photo mode has no smoothing to fight,
    // and framing that quietly refuses to go underground is what's wanted.
    y = Math.max(y, minCameraY(x, z, this.focus.x, this.focus.y, this.focus.z));

    camera.position.set(x, y, z);
    camera.up.set(0, 1, 0);
    camera.lookAt(this.focus);
    camera.updateProjectionMatrix();
  }

  /**
   * Renders the scene through the grade. Used in photo mode only — normal play
   * renders straight to the canvas and skips the extra target entirely.
   */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.material.uniforms.uFilter.value = FILTERS.indexOf(this.filter);
    this.material.uniforms.uVignette.value = this.vignette;

    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(this.quadScene, this.quadCamera);
  }

  /**
   * Must be called in the same frame as a render — without `preserveDrawingBuffer`
   * the buffer is cleared once the frame is composited, and a capture taken any
   * later comes back blank.
   */
  capture(): Promise<Blob | null> {
    // Signed on the way out. A screenshot of this game is the most likely thing
    // anyone ever shares of it, and an unsigned one is a beautiful picture with
    // no way back to the thing that made it — the single cheapest piece of
    // distribution there is, and it costs one 2D canvas blit.
    const signed = document.createElement('canvas');
    signed.width = this.canvas.width;
    signed.height = this.canvas.height;
    const ctx = signed.getContext('2d');
    if (!ctx) {
      return new Promise((resolve) => this.canvas.toBlob((b) => resolve(b), 'image/png'));
    }
    ctx.drawImage(this.canvas, 0, 0);
    drawWatermark(ctx, signed.width, signed.height);
    return new Promise((resolve) => {
      signed.toBlob((blob) => resolve(blob), 'image/png');
    });
  }

  private bindPointer() {
    this.canvas.addEventListener('pointerdown', (e) => {
      if (!this.active) return;
      this.dragging = true;
      this.lastPointer = { x: e.clientX, y: e.clientY };
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.active || !this.dragging) return;
      const dx = e.clientX - this.lastPointer.x;
      const dy = e.clientY - this.lastPointer.y;
      this.lastPointer = { x: e.clientX, y: e.clientY };
      this.yaw -= dx * 0.006;
      // Clamped short of straight up/down, where lookAt degenerates.
      this.pitch = clamp(this.pitch + dy * 0.005, -0.35, 1.35);
    });
    const stop = (e: PointerEvent) => {
      this.dragging = false;
      if (this.canvas.hasPointerCapture(e.pointerId)) {
        this.canvas.releasePointerCapture(e.pointerId);
      }
    };
    this.canvas.addEventListener('pointerup', stop);
    this.canvas.addEventListener('pointercancel', stop);
    this.canvas.addEventListener('wheel', (e) => {
      if (!this.active) return;
      this.distance = clamp(this.distance + e.deltaY * 0.012, 4, 34);
      e.preventDefault();
    }, { passive: false });
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * The mark burned into the bottom-right of every saved photo.
 *
 * Scaled off the image height rather than fixed, so a phone capture and a 4K
 * desktop one carry the same *proportion* of mark. Deliberately small and warm
 * — this has to survive being posted without looking like a stock-photo
 * watermark slapped across someone's picture. A shadow behind it because the
 * corner it sits in could be bright sand or a night sky, and text with only one
 * of those in mind disappears against the other.
 */
function drawWatermark(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const scale = h / 1080;
  const pad = Math.round(28 * scale);
  const size = Math.max(11, Math.round(22 * scale));

  ctx.save();
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
  ctx.shadowBlur = Math.round(6 * scale);
  ctx.shadowOffsetY = Math.round(1 * scale);

  ctx.font = `600 ${size}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.fillStyle = 'rgba(255, 235, 214, 0.92)';
  ctx.fillText(GAME_NAME, w - pad, h - pad - Math.round(size * 0.95));

  ctx.font = `400 ${Math.max(9, Math.round(size * 0.68))}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.fillStyle = 'rgba(255, 235, 214, 0.66)';
  ctx.fillText(GAME_URL_SHORT, w - pad, h - pad);
  ctx.restore();
}
