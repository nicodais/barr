import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { heightAt } from '../terrain/height';

/**
 * A herd of gazelle, roaming the region.
 *
 * They graze, drift, and break away if the truck gets close — which is the one
 * bit of interaction they have, and the reason they're worth having at all. A
 * herd that ignores you is scenery; a herd that notices you and moves off makes
 * the desert feel like somewhere you're a visitor.
 *
 * Two InstancedMeshes (coat and dark parts). The walk cycle is a vertex
 * displacement driven by per-instance phase and gait, so the whole herd animates
 * without a skeleton and without extra draw calls.
 */
const HERD_RADIUS = 26;
/** The truck inside this distance sends them running. */
const FLEE_RADIUS = 62;
const GRAZE_SPEED = 1.5;
const FLEE_SPEED = 13;
/** Kept near the player; the herd is re-seeded rather than simulated worldwide. */
const KEEP_RADIUS = 340;

interface Gazelle {
  x: number;
  z: number;
  y: number;
  heading: number;
  speed: number;
  offsetX: number;
  offsetZ: number;
}

export class Wildlife {
  readonly group = new THREE.Group();

  private coat: THREE.InstancedMesh;
  private dark: THREE.InstancedMesh;
  private herd: Gazelle[] = [];
  private herdX = 0;
  private herdZ = 0;
  private targetX = 0;
  private targetZ = 0;
  private spooked = 0;
  private wanderTimer = 0;

  private dummy = new THREE.Object3D();
  private timeUniform = { value: 0 };
  private gait: Float32Array;

  constructor(capacity = 9) {
    const parts = buildGazelle();

    const phases = new Float32Array(capacity);
    this.gait = new Float32Array(capacity);
    for (let i = 0; i < capacity; i++) phases[i] = Math.random() * Math.PI * 2;

    const attach = (geo: THREE.BufferGeometry) => {
      geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
      geo.setAttribute('aGait', new THREE.InstancedBufferAttribute(this.gait, 1));
      return geo;
    };

    this.coat = this.makeMesh(attach(parts.coat), 0xbb9d6d, capacity);
    this.dark = this.makeMesh(attach(parts.dark), 0x4b4038, capacity);
    this.group.add(this.coat, this.dark);
    this.group.matrixAutoUpdate = false;
  }

  setCount(n: number) {
    const target = Math.max(0, Math.min(this.coat.instanceMatrix.count, Math.floor(n)));
    while (this.herd.length < target) {
      this.herd.push({
        x: 0, z: 0, y: 0, heading: Math.random() * Math.PI * 2, speed: 0,
        offsetX: (Math.random() - 0.5) * HERD_RADIUS * 2,
        offsetZ: (Math.random() - 0.5) * HERD_RADIUS * 2,
      });
    }
    if (this.herd.length > target) this.herd.length = target;
    this.coat.count = target;
    this.dark.count = target;
  }

  update(dt: number, focusX: number, focusZ: number) {
    this.timeUniform.value += dt;
    if (this.herd.length === 0) return;

    // Re-seed the whole herd if the player has left it behind entirely.
    if (Math.hypot(this.herdX - focusX, this.herdZ - focusZ) > KEEP_RADIUS) {
      const a = Math.random() * Math.PI * 2;
      const d = KEEP_RADIUS * 0.55;
      this.herdX = focusX + Math.cos(a) * d;
      this.herdZ = focusZ + Math.sin(a) * d;
      this.targetX = this.herdX;
      this.targetZ = this.herdZ;
      for (const g of this.herd) {
        g.x = this.herdX + g.offsetX;
        g.z = this.herdZ + g.offsetZ;
      }
    }

    const toTruck = Math.hypot(this.herdX - focusX, this.herdZ - focusZ);
    if (toTruck < FLEE_RADIUS) {
      // Pick a heading directly away and commit to it for a few seconds.
      this.spooked = 3.5;
      const away = Math.atan2(this.herdX - focusX, this.herdZ - focusZ);
      this.targetX = this.herdX + Math.sin(away) * 140;
      this.targetZ = this.herdZ + Math.cos(away) * 140;
    }
    this.spooked = Math.max(0, this.spooked - dt);

    this.wanderTimer -= dt;
    if (this.wanderTimer <= 0 && this.spooked <= 0) {
      this.wanderTimer = 6 + Math.random() * 10;
      const a = Math.random() * Math.PI * 2;
      const d = 40 + Math.random() * 70;
      this.targetX = this.herdX + Math.cos(a) * d;
      this.targetZ = this.herdZ + Math.sin(a) * d;
    }

    const herdSpeed = this.spooked > 0 ? FLEE_SPEED : GRAZE_SPEED;
    const dx = this.targetX - this.herdX;
    const dz = this.targetZ - this.herdZ;
    const dist = Math.hypot(dx, dz) || 1;
    this.herdX += (dx / dist) * herdSpeed * dt;
    this.herdZ += (dz / dist) * herdSpeed * dt;

    for (let i = 0; i < this.herd.length; i++) {
      const g = this.herd[i];
      const goalX = this.herdX + g.offsetX;
      const goalZ = this.herdZ + g.offsetZ;
      const gdx = goalX - g.x;
      const gdz = goalZ - g.z;
      const gdist = Math.hypot(gdx, gdz);

      // Only bother moving if meaningfully out of position, so a settled herd
      // stands still and grazes instead of jittering on the spot.
      if (gdist > 1.2) {
        const speed = this.spooked > 0 ? FLEE_SPEED : GRAZE_SPEED;
        g.speed += (speed - g.speed) * Math.min(1, dt * 2);
        g.x += (gdx / gdist) * g.speed * dt;
        g.z += (gdz / gdist) * g.speed * dt;
        const want = Math.atan2(gdx, gdz);
        g.heading += wrapAngle(want - g.heading) * Math.min(1, dt * 3.5);
      } else {
        g.speed += (0 - g.speed) * Math.min(1, dt * 2.5);
      }

      g.y = heightAt(g.x, g.z);
      this.gait[i] = Math.min(1, g.speed / 4);

      this.dummy.position.set(g.x, g.y, g.z);
      this.dummy.rotation.set(0, g.heading, 0);
      this.dummy.updateMatrix();
      this.coat.setMatrixAt(i, this.dummy.matrix);
      this.dark.setMatrixAt(i, this.dummy.matrix);
    }

    this.coat.instanceMatrix.needsUpdate = true;
    this.dark.instanceMatrix.needsUpdate = true;
    (this.coat.geometry.getAttribute('aGait') as THREE.BufferAttribute).needsUpdate = true;
    (this.dark.geometry.getAttribute('aGait') as THREE.BufferAttribute).needsUpdate = true;
  }

  private makeMesh(
    geometry: THREE.BufferGeometry,
    color: number,
    capacity: number,
  ): THREE.InstancedMesh {
    const material = new THREE.MeshLambertMaterial({ color, flatShading: true });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.timeUniform;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nuniform float uTime;\nattribute float aPhase;\nattribute float aGait;',
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           // Legs swing fore/aft, diagonal pairs in antiphase; the body bobs.
           float legMask = smoothstep( 0.62, 0.12, transformed.y );
           float pairOffset = transformed.z > 0.0 ? 0.0 : 3.14159;
           float cycle = uTime * 9.0 + aPhase + pairOffset;
           transformed.z += sin( cycle ) * legMask * 0.26 * aGait;
           transformed.y += abs( sin( uTime * 9.0 + aPhase ) ) * 0.04 * aGait;`,
        );
    };

    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.count = 0;
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    return mesh;
  }
}

/** Slender, long-legged, faces +Z. Split by material so legs can be darker. */
function buildGazelle(): { coat: THREE.BufferGeometry; dark: THREE.BufferGeometry } {
  const coat: THREE.BufferGeometry[] = [];
  const dark: THREE.BufferGeometry[] = [];

  const body = new THREE.BoxGeometry(0.4, 0.44, 1.0);
  body.translate(0, 0.82, 0);
  coat.push(body);

  const rump = new THREE.BoxGeometry(0.36, 0.38, 0.3);
  rump.translate(0, 0.86, -0.55);
  coat.push(rump);

  const neck = new THREE.BoxGeometry(0.19, 0.46, 0.2);
  neck.rotateX(-0.42);
  neck.translate(0, 1.12, 0.44);
  coat.push(neck);

  const head = new THREE.BoxGeometry(0.16, 0.17, 0.34);
  head.rotateX(0.2);
  head.translate(0, 1.36, 0.62);
  coat.push(head);

  // Legs, in four pairs of upper/lower so the swing mask has something to bend.
  for (const sx of [-1, 1]) {
    for (const sz of [1, -1]) {
      const leg = new THREE.BoxGeometry(0.085, 0.78, 0.1);
      leg.translate(sx * 0.15, 0.39, sz * 0.34);
      dark.push(leg);
      const hoof = new THREE.BoxGeometry(0.1, 0.09, 0.12);
      hoof.translate(sx * 0.15, 0.05, sz * 0.34);
      dark.push(hoof);
    }
  }

  // Horns: short, swept back.
  for (const sx of [-1, 1]) {
    const horn = new THREE.ConeGeometry(0.026, 0.3, 4);
    horn.rotateX(-0.5);
    horn.translate(sx * 0.055, 1.55, 0.55);
    dark.push(horn);
  }

  const muzzle = new THREE.BoxGeometry(0.13, 0.11, 0.1);
  muzzle.translate(0, 1.31, 0.79);
  dark.push(muzzle);

  const tail = new THREE.BoxGeometry(0.06, 0.2, 0.06);
  tail.rotateX(0.3);
  tail.translate(0, 0.86, -0.72);
  dark.push(tail);

  return {
    coat: mergeGeometries(coat, false) ?? body,
    dark: mergeGeometries(dark, false) ?? body,
  };
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
