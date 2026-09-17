import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import type { SkyState } from './TimeOfDay';

/** A prefiltered sky probe gives paint, glass and metal a shared horizon.
 * Rebuild for meaningful lighting changes, never every rendered frame. */
export class Environment {
  private generator: THREE.PMREMGenerator;
  private scene = new THREE.Scene();
  private target: THREE.WebGLRenderTarget | null = null;
  private direction = new THREE.Vector3(0, -10, 0);
  private haze = -1;
  private night = -1;
  private updatedAt = -Infinity;
  private photographicBlend = { value: 0 };
  private photograph: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> | null = null;
  private disposed = false;
  private domeMaterial: THREE.ShaderMaterial;

  constructor(renderer: THREE.WebGLRenderer, sky: THREE.Mesh) {
    this.generator = new THREE.PMREMGenerator(renderer);
    const dome = sky.clone();
    const source = sky.material as THREE.ShaderMaterial;
    this.domeMaterial = source.clone();
    this.domeMaterial.uniforms = { ...source.uniforms, uPhotographicBlend: this.photographicBlend };
    this.domeMaterial.fragmentShader = 'uniform float uPhotographicBlend;\n' + source.fragmentShader.replace('gl_FragColor = vec4(color, 1.0);', 'gl_FragColor = vec4(color, 1.0 - uPhotographicBlend);');
    this.domeMaterial.transparent = true;
    dome.material = this.domeMaterial;
    dome.position.set(0, 0, 0);
    dome.scale.setScalar(50);
    dome.updateMatrix();
    this.scene.add(dome);
    new HDRLoader().setDataType(THREE.FloatType).load(import.meta.env.BASE_URL + 'textures/aarfontein_pan_1k.hdr', texture => {
      if (this.disposed) { texture.dispose(); return; }
      // Keep the photograph's broad lighting range; the game's directional sun
      // owns the sharp solar highlight and shadows as time advances.
      const values = texture.image.data as Float32Array;
      for (let i=0;i<values.length;i+=4) {
        const peak = Math.max(values[i], values[i+1], values[i+2]);
        if (peak > 4) { const scale = (4 + Math.log1p(peak-4)*.08)/peak; values[i]*=scale; values[i+1]*=scale; values[i+2]*=scale; }
      }
      texture.needsUpdate = true;
      const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide, depthWrite: false, toneMapped: false });
      this.photograph = new THREE.Mesh(new THREE.SphereGeometry(45,64,32),material);
      this.photograph.renderOrder = -1002;
      this.photograph.frustumCulled = false;
      this.scene.add(this.photograph);
      this.updatedAt = -Infinity;
      this.direction.set(0,-10,0);
    });
  }

  update(scene: THREE.Scene, state: SkyState, direction: THREE.Vector3) {
    const changed = this.direction.distanceToSquared(direction) > 0.0016
      || Math.abs(this.haze - state.haze) > 0.06
      || Math.abs(this.night - state.night) > 0.04;
    const now = performance.now();
    if (this.target && (!changed || now - this.updatedAt < 1000)) return;
    this.photographicBlend.value = this.photograph ? .65 * (1-state.night)**2 * (1-state.haze*.7) : 0;
    if (this.photograph) {
      this.photograph.material.color.copy(state.sunColor).lerp(new THREE.Color(0xffffff), .55).multiplyScalar(.7);
      this.photograph.rotation.y = state.azimuth;
    }
    const previous = this.target;
    this.target = this.generator.fromScene(this.scene, 0.025, 0.1, 100, { size: 128 });
    scene.environment = this.target.texture;
    previous?.dispose();
    this.direction.copy(direction);
    this.haze = state.haze;
    this.night = state.night;
    this.updatedAt = now;
  }

  dispose() {
    this.disposed = true;
    this.domeMaterial.dispose();
    if (this.photograph) { this.photograph.geometry.dispose(); this.photograph.material.map?.dispose(); this.photograph.material.dispose(); }
    this.target?.dispose();
    this.generator.dispose();
    this.scene.clear();
  }
}
