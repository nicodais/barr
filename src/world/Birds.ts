import * as THREE from 'three';
import { heightAt } from '../terrain/height';

/**
 * A few birds, high up and going about their business (§1: texture, not content).
 *
 * Sparse on purpose. One or two crossing the sky occasionally reads as a living
 * desert; a flock wheeling overhead reads as a bird level. They never interact
 * with the player and are never pointed out.
 *
 * One InstancedMesh for the lot. The wingbeat is a vertex displacement keyed off
 * a per-instance phase, so a dozen birds flapping out of sync still cost a
 * single draw call.
 */
const RADIUS = 420;
const MIN_ALTITUDE = 38;
const MAX_ALTITUDE = 90;

interface Bird {
  x: number;
  y: number;
  z: number;
  heading: number;
  turn: number;
  speed: number;
  altitude: number;
}

export class Birds {
  readonly mesh: THREE.InstancedMesh;

  private birds: Bird[] = [];
  private dummy = new THREE.Object3D();
  private timeUniform = { value: 0 };
  private active = 0;

  constructor(capacity = 14) {
    const geometry = buildBird();
    const phases = new Float32Array(capacity);
    for (let i = 0; i < capacity; i++) phases[i] = Math.random() * Math.PI * 2;
    geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));

    const material = new THREE.MeshLambertMaterial({
      color: 0x4a4740,
      flatShading: true,
      side: THREE.DoubleSide,
    });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.timeUniform;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nuniform float uTime;\nattribute float aPhase;',
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           // Wingtips travel furthest, so deflection scales with span.
           float flap = sin( uTime * 7.5 + aPhase );
           transformed.y += flap * abs( transformed.x ) * 0.62;`,
        );
    };

    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.count = 0;
  }

  /** Lower tiers simply fly fewer birds. */
  setCount(n: number) {
    const target = Math.max(0, Math.min(this.mesh.instanceMatrix.count, Math.floor(n)));
    while (this.birds.length < target) this.birds.push(this.spawn(0, 0, true));
    if (this.birds.length > target) this.birds.length = target;
    this.active = target;
    this.mesh.count = target;
  }

  update(dt: number, focusX: number, focusZ: number) {
    this.timeUniform.value += dt;
    if (this.active === 0) return;

    for (let i = 0; i < this.birds.length; i++) {
      const b = this.birds[i];

      // Lazy, drifting turns rather than anything purposeful.
      b.turn += (Math.random() - 0.5) * 0.35 * dt;
      b.turn = THREE.MathUtils.clamp(b.turn, -0.28, 0.28);
      b.heading += b.turn * dt;

      b.x += Math.sin(b.heading) * b.speed * dt;
      b.z += Math.cos(b.heading) * b.speed * dt;

      // Hold altitude above whatever terrain has passed underneath.
      const target = heightAt(b.x, b.z) + b.altitude;
      b.y += (target - b.y) * Math.min(1, dt * 0.6);

      // Wandered too far to be seen — bring it back in on the far side rather
      // than letting the sky slowly empty out.
      if (Math.hypot(b.x - focusX, b.z - focusZ) > RADIUS) {
        Object.assign(b, this.spawn(focusX, focusZ, false));
      }

      this.dummy.position.set(b.x, b.y, b.z);
      this.dummy.rotation.set(0, b.heading, 0);
      this.dummy.scale.setScalar(1);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  private spawn(focusX: number, focusZ: number, anywhere: boolean): Bird {
    const angle = Math.random() * Math.PI * 2;
    const dist = anywhere ? Math.random() * RADIUS : RADIUS * 0.92;
    const x = focusX + Math.cos(angle) * dist;
    const z = focusZ + Math.sin(angle) * dist;
    const altitude = MIN_ALTITUDE + Math.random() * (MAX_ALTITUDE - MIN_ALTITUDE);
    return {
      x,
      z,
      y: heightAt(x, z) + altitude,
      // Aimed loosely back across the player's area so they cross the view.
      heading: Math.atan2(focusX - x, focusZ - z) + (Math.random() - 0.5) * 1.4,
      turn: 0,
      speed: 7 + Math.random() * 6,
      altitude,
    };
  }
}

/** A swept-wing silhouette. Read at distance, so it's four triangles. */
function buildBird(): THREE.BufferGeometry {
  const span = 0.95;
  const sweep = 0.34;
  const positions = new Float32Array([
    // Left wing
    0, 0, 0.18,
    -span, 0, -sweep,
    0, 0, -0.22,
    // Right wing
    0, 0, 0.18,
    0, 0, -0.22,
    span, 0, -sweep,
  ]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}
