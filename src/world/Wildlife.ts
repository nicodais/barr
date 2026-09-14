import * as THREE from 'three';
import { buildGazelle, patchAnimal } from './animalGeometry';
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

    this.coat = this.makeMesh(attach(parts.coat), capacity);
    this.dark = this.makeMesh(attach(parts.dark), capacity);
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
    capacity: number,
  ): THREE.InstancedMesh {
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.88 });
    material.onBeforeCompile = shader => patchAnimal(shader, this.timeUniform, false);

    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.count = 0;
    mesh.castShadow = true;
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    depth.onBeforeCompile = shader => patchAnimal(shader, this.timeUniform, false);
    mesh.customDepthMaterial = depth;
    mesh.frustumCulled = false;
    return mesh;
  }
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
