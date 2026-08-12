import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
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
  private clock = 0;

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

    // Darker than a real camel, which is close to the colour of the sand it
    // stands on — accurate and unreadable. Pushed down and slightly cooler so
    // the silhouette separates at the distance you actually spot one from.
    this.coat = this.makeMesh(attach(parts.coat), 0xa2764a);
    this.dark = this.makeMesh(attach(parts.dark), 0x6b4f31);
    this.group.add(this.coat, this.dark);
    this.group.matrixAutoUpdate = false;
  }

  update(dt: number, focusX: number, focusZ: number) {
    this.timeUniform.value += dt;
    this.clock += dt;

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

      for (let k = 0; k < str.count; k++, i++) {
        // Position along a loop that isn't quite a circle — two low harmonics
        // are enough that the path reads as a track worn into the ground rather
        // than a turntable.
        const along =
          str.phase +
          str.direction * ((this.clock * PLOD_SPEED) / str.radius) -
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

  private makeMesh(geometry: THREE.BufferGeometry, color: number): THREE.InstancedMesh {
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
           // A camel paces: both legs on one side swing together, which is why
           // a ridden one rolls side to side. That's the gait to get right —
           // it's the only thing that distinguishes this silhouette from a
           // large horse at any distance you'd actually see it from.
           float legMask = smoothstep( 1.35, 0.35, transformed.y );
           float body = 1.0 - legMask;
           float walk = uTime * 3.1 + aPhase;

           // The per-side half-cycle is what makes it a pace, and it must stay
           // on the legs. Applied to the body it split the mesh down x=0: the
           // left half shifted +6cm while the right went -6cm, opening a 12cm
           // crack the length of the barrel and straight up the neck.
           float sideOffset = transformed.x > 0.0 ? 0.0 : 3.14159;
           transformed.z += sin( walk + sideOffset ) * legMask * 0.34 * aGait;

           // The roll and the nod ride the *whole* body on one phase.
           transformed.x += sin( walk ) * body * 0.06 * aGait;
           transformed.y += sin( uTime * 6.2 + aPhase ) * 0.035 * aGait;

           // Standing still, and never actually still. A string halts whenever
           // the player is inside ~96m of it, which is the only range you can
           // make out a camel at — so without this the animal is a statue every
           // single time anyone is close enough to look at it. That, not the
           // walk cycle, is why they read as broken.
           float idle = 1.0 - aGait;
           float neck = smoothstep( 2.2, 2.95, transformed.y );
           transformed.y += sin( uTime * 0.85 + aPhase ) * 0.022 * idle;
           transformed.z += sin( uTime * 0.5 + aPhase * 1.7 ) * 0.09 * neck * idle;
           transformed.x += sin( uTime * 0.37 + aPhase ) * 0.06 * neck * idle;`,
        );
    };

    const mesh = new THREE.InstancedMesh(geometry, material, CAPACITY);
    mesh.count = CAPACITY;
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    return mesh;
  }
}

/** Tall, humped, long-necked, small-headed. Faces +Z, ground at y=0. */
function buildCamel(): { coat: THREE.BufferGeometry; dark: THREE.BufferGeometry } {
  const coat: THREE.BufferGeometry[] = [];
  const dark: THREE.BufferGeometry[] = [];

  // Barrel. Deep and short — a camel is mostly ribcage and legs.
  const body = new THREE.BoxGeometry(0.78, 0.86, 1.9);
  body.translate(0, 1.62, 0);
  coat.push(body);

  // The hump. One, not two: the dromedary is what's here.
  const hump = new THREE.BoxGeometry(0.62, 0.62, 0.98);
  hump.translate(0, 2.24, -0.12);
  coat.push(hump);
  const humpTop = new THREE.BoxGeometry(0.4, 0.3, 0.66);
  humpTop.translate(0, 2.6, -0.14);
  coat.push(humpTop);

  const chest = new THREE.BoxGeometry(0.68, 0.6, 0.5);
  chest.translate(0, 1.5, 0.98);
  coat.push(chest);

  // Neck: two segments, the second pitched back, so it makes the S a camel's
  // neck actually makes rather than a straight tube pointing forward.
  // The sign here is load-bearing and was wrong: rotateX tips the *top* of a
  // Y-aligned box toward +Z for a positive angle, so -0.55 leaned the lower
  // neck backwards. That put its base at z=1.42, hanging in front of a chest
  // that ends at 1.23, and left its top 0.53m short of where the upper neck
  // starts. The neck rendered as a detached bar floating above the shoulder,
  // which at night reads as a flag on a pole.
  const neckLow = new THREE.BoxGeometry(0.32, 1.0, 0.36);
  neckLow.rotateX(0.55);
  neckLow.translate(0, 2.16, 1.16);
  coat.push(neckLow);
  const neckHigh = new THREE.BoxGeometry(0.28, 0.82, 0.3);
  neckHigh.rotateX(0.22);
  neckHigh.translate(0, 2.86, 1.5);
  coat.push(neckHigh);

  const head = new THREE.BoxGeometry(0.24, 0.28, 0.52);
  head.rotateX(0.42);
  head.translate(0, 3.26, 1.62);
  coat.push(head);
  const muzzle = new THREE.BoxGeometry(0.19, 0.18, 0.3);
  muzzle.rotateX(0.42);
  muzzle.translate(0, 3.11, 1.92);
  dark.push(muzzle);

  for (const sx of [-1, 1]) {
    const ear = new THREE.BoxGeometry(0.06, 0.13, 0.09);
    ear.translate(sx * 0.11, 3.42, 1.46);
    dark.push(ear);
  }

  // Legs. Long, with the knee bulge that gives them their shape, and the wide
  // splayed foot that is the reason the animal works on sand at all.
  for (const sx of [-1, 1]) {
    for (const sz of [0.72, -0.68]) {
      const upper = new THREE.BoxGeometry(0.19, 0.78, 0.24);
      upper.translate(sx * 0.28, 1.02, sz);
      coat.push(upper);
      const knee = new THREE.BoxGeometry(0.22, 0.2, 0.26);
      knee.translate(sx * 0.28, 0.66, sz);
      dark.push(knee);
      const lower = new THREE.BoxGeometry(0.14, 0.58, 0.16);
      lower.translate(sx * 0.28, 0.34, sz);
      dark.push(lower);
      const foot = new THREE.BoxGeometry(0.28, 0.1, 0.34);
      foot.translate(sx * 0.28, 0.05, sz + 0.02);
      dark.push(foot);
    }
  }

  const tail = new THREE.BoxGeometry(0.08, 0.52, 0.08);
  tail.rotateX(0.35);
  tail.translate(0, 1.66, -1.02);
  dark.push(tail);

  const box = new THREE.BoxGeometry(0.1, 0.1, 0.1);
  return {
    coat: mergeGeometries(coat, false) ?? box,
    dark: mergeGeometries(dark, false) ?? box,
  };
}
