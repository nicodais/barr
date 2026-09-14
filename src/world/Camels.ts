import * as THREE from 'three';
import { buildCamel, patchAnimal } from './animalGeometry';
import { heightAt } from '../terrain/height';

/**
 * Camels, plodding.
 *
 * Deliberately not folded into Wildlife, because the whole point of them is
 * that they behave like the opposite of the gazelle. A gazelle herd notices the
 * truck and bolts, which makes the desert feel like somewhere you're a visitor.
 * A camel string notices the truck, stops, looks at it, and then carries on,
 * which makes the desert feel like somewhere that was here first. You need both
 * readings for the world to have any temperature at all.
 *
 * They're also world-fixed rather than seeded around the player. A herd that
 * follows you is atmosphere; a string that lives at one end of the map is
 * somewhere you can go back to and find again — which is what turns it from a
 * particle effect into a place.
 *
 * Two InstancedMeshes and a vertex-displaced walk cycle, same approach as the
 * gazelle: no skeleton, no extra draw calls (§8).
 */

/** How close the truck has to be before a string stops to look. */
const NOTICE_RADIUS = 34;
/**
 * How long they stand and look before going back to it.
 *
 * The class comment always said a string "stops, looks at it, and then carries
 * on" — the carrying on was missing. `want` was a pure function of proximity, so
 * they stayed halted for exactly as long as the player was nearby, which is the
 * whole time anyone can see them. Standing still forever while being watched is
 * what an obstacle does, not an animal.
 */
const LOOK_TIME = 5.5;
/** Walking pace, m/s. A working camel does about this and no more. */
const PLOD_SPEED = 1.25;
/** Nose-to-tail spacing along the line. */
const SPACING = 4.4;

interface String_ {
  /** Centre of the loop this string walks. */
  cx: number;
  cz: number;
  radius: number;
  count: number;
  /** Starting position along the loop, radians. */
  phase: number;
  /** +1 or -1. */
  direction: number;
}

/**
 * Where the camels are. Both strings sit near places that already mean
 * something: the old racing track, and the road head by the tea stand where
 * anything with legs ends up.
 */
const STRINGS: String_[] = [
  { cx: -120, cz: 525, radius: 62, count: 5, phase: 0.4, direction: 1 },
  { cx: 70, cz: 145, radius: 39, count: 3, phase: 2.4, direction: 1 },
  { cx: -640, cz: 560, radius: 44, count: 3, phase: 2.7, direction: -1 },
];

const CAPACITY = STRINGS.reduce((n, s) => n + s.count, 0);

export class Camels {
  readonly group = new THREE.Group();

  private coat: THREE.InstancedMesh;
  private dark: THREE.InstancedMesh;
  private dummy = new THREE.Object3D();
  private timeUniform = { value: 0 };
  /** Per-instance 0..1 walk strength; drops to zero when a string halts. */
  private gait = new Float32Array(CAPACITY);
  private phases = new Float32Array(CAPACITY);
  /** Per-string 0..1, how much the string is currently moving. */
  private motion: number[] = STRINGS.map(() => 1);
  /** Countdown of the look. Armed on arrival, not held by proximity. */
  private looking: number[] = STRINGS.map(() => 0);
  private wasNear: boolean[] = STRINGS.map(() => false);
  private travel = STRINGS.map(() => 0);

  constructor() {
    const parts = buildCamel();
    for (let i = 0; i < CAPACITY; i++) {
      this.phases[i] = Math.random() * Math.PI * 2;
      this.gait[i] = 1;
    }

    const attach = (geo: THREE.BufferGeometry) => {
      geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(this.phases, 1));
      geo.setAttribute('aGait', new THREE.InstancedBufferAttribute(this.gait, 1));
      return geo;
    };

    this.coat = this.makeMesh(attach(parts.coat));
    this.dark = this.makeMesh(attach(parts.dark));
    this.group.add(this.coat, this.dark);
    this.group.matrixAutoUpdate = false;
  }

  update(dt: number, focusX: number, focusZ: number) {
    this.timeUniform.value += dt;

    let i = 0;
    for (let s = 0; s < STRINGS.length; s++) {
      const str = STRINGS[s];

      // Stop and look, don't run. Eased rather than switched, because a camel
      // going from walking to stopped in one frame is the tell that this is a
      // state machine and not an animal.
      // Armed on the *transition* into range rather than sampled while in it,
      // so the look has a beginning and an end and they get back to walking
      // with you still standing there.
      const near = Math.hypot(str.cx - focusX, str.cz - focusZ) < NOTICE_RADIUS + str.radius;
      if (near && !this.wasNear[s]) this.looking[s] = LOOK_TIME;
      this.wasNear[s] = near;
      if (this.looking[s] > 0) this.looking[s] -= dt;

      const want = this.looking[s] > 0 ? 0 : 1;
      this.motion[s] += (want - this.motion[s]) * Math.min(1, dt * 1.1);

      this.travel[s] += dt * this.motion[s];
      for (let k = 0; k < str.count; k++, i++) {
        // Position along a loop that isn't quite a circle — two low harmonics
        // are enough that the path reads as a track worn into the ground rather
        // than a turntable.
        const along =
          str.phase +
          str.direction * ((this.travel[s] * PLOD_SPEED) / str.radius) -
          (k * SPACING) / str.radius;
        const wobbleR =
          str.radius * (1 + 0.16 * Math.sin(along * 2 + s) + 0.07 * Math.sin(along * 3.3));
        const x = str.cx + Math.cos(along) * wobbleR;
        const z = str.cz + Math.sin(along) * wobbleR;

        // Heading from a short step further along the same path, so it always
        // points where it is actually going, wobble included.
        const ahead = along + str.direction * 0.02;
        const aheadR =
          str.radius * (1 + 0.16 * Math.sin(ahead * 2 + s) + 0.07 * Math.sin(ahead * 3.3));
        const hx = str.cx + Math.cos(ahead) * aheadR - x;
        const hz = str.cz + Math.sin(ahead) * aheadR - z;

        this.gait[i] = this.motion[s];
        this.dummy.position.set(x, heightAt(x, z), z);
        this.dummy.rotation.set(0, Math.atan2(hx, hz), 0);
        this.dummy.updateMatrix();
        this.coat.setMatrixAt(i, this.dummy.matrix);
        this.dark.setMatrixAt(i, this.dummy.matrix);
      }
    }

    this.coat.instanceMatrix.needsUpdate = true;
    this.dark.instanceMatrix.needsUpdate = true;
    (this.coat.geometry.getAttribute('aGait') as THREE.BufferAttribute).needsUpdate = true;
    (this.dark.geometry.getAttribute('aGait') as THREE.BufferAttribute).needsUpdate = true;
  }

  private makeMesh(geometry: THREE.BufferGeometry): THREE.InstancedMesh {
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.88 });
    material.onBeforeCompile = (shader) => this.patch(shader);

    const mesh = new THREE.InstancedMesh(geometry, material, CAPACITY);
    mesh.count = CAPACITY;
    mesh.castShadow = true;
    mesh.frustumCulled = false;

    /**
     * The same displacement again, for the shadow.
     *
     * `onBeforeCompile` patches the material the camera sees. It does not touch
     * the depth material the shadow map is rendered with — that is a separate
     * program three.js builds itself — so a walking camel was casting the shadow
     * of a standing one, legs together, while its own legs swung. Handing the
     * mesh a `customDepthMaterial` carrying the identical vertex code is the
     * only way to keep the two in step.
     *
     * Anything instanced-and-animated added later needs this too; there is no
     * warning when it's missing, just a shadow that doesn't move.
     */
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    depth.onBeforeCompile = (shader) => this.patch(shader);
    mesh.customDepthMaterial = depth;

    return mesh;
  }

  /** The gait, as vertex GLSL. Shared verbatim by the lit and depth programs. */
  private patch(shader: THREE.WebGLProgramParametersWithUniforms) {
    patchAnimal(shader, this.timeUniform, true);
  }
}
