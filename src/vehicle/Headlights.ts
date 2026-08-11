import * as THREE from 'three';

/**
 * Headlights.
 *
 * Night is worth having for its own sake — a clear sky over the Empty Quarter
 * is the thing people drive out here to see — but a night you can't drive in is
 * a night the player will just skip past on the time slider. Two beams on the
 * sand is what turns it from a screensaver back into the game, and it changes
 * how the driving reads: you can only see one dune ahead, so you slow down and
 * pick your line off what the beams find. That's a different, quieter version
 * of the same activity, which is exactly what §1 is after.
 *
 * Two spot lights, no shadows. They live in the scene permanently at zero
 * intensity through the day rather than being added at dusk: three recompiles
 * every material in the scene when the light count changes, and taking a
 * hundred-millisecond hitch every sunset to save a couple of ALU ops per
 * fragment is a bad trade in a game whose whole proposition is that nothing
 * jars.
 */

/** Where the lamps sit on the body, relative to the vehicle origin. */
const LAMP_X = 0.66;
const LAMP_Y = 0.22;
const LAMP_Z = 2.0;

/** How far ahead the beams are aimed, and how far down. */
const AIM_Z = 26;
const AIM_Y = -3.4;

const WARM = new THREE.Color(0xffe3b4);

export class Headlights {
  /** Parent this to the vehicle view root so it inherits the body transform. */
  readonly group = new THREE.Group();

  private lights: THREE.SpotLight[] = [];
  private glows: THREE.Mesh[] = [];
  private intensity = 0;

  constructor() {
    for (const side of [-1, 1]) {
      const light = new THREE.SpotLight(WARM.getHex(), 0);
      light.position.set(side * LAMP_X, LAMP_Y, LAMP_Z);
      // A wide, soft cone. A tight one looks like a torch and, worse, puts a
      // hard ellipse on the sand that slides around as the suspension works.
      light.angle = 0.62;
      light.penumbra = 0.75;
      light.distance = 85;
      // Physical falloff (2) puts almost all the light in the first ten metres
      // and leaves nothing at the range you actually need to read a dune face
      // at speed. 1.1 is wrong and useful.
      light.decay = 1.1;
      light.castShadow = false;
      light.target.position.set(side * LAMP_X * 0.5, AIM_Y, AIM_Z);
      this.group.add(light, light.target);
      this.lights.push(light);

      // The lamp face itself. Unlit and additive, so it reads as a source
      // rather than as a pale surface — the one thing in the world allowed to
      // be brighter than the sky.
      const glow = new THREE.Mesh(
        new THREE.CircleGeometry(0.13, 8),
        new THREE.MeshBasicMaterial({
          color: WARM,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      glow.position.set(side * LAMP_X, LAMP_Y, LAMP_Z + 0.06);
      glow.renderOrder = 11;
      this.group.add(glow);
      this.glows.push(glow);
    }
  }

  /** @param night 0..1, straight off the day curve. */
  setNight(night: number) {
    // Snap on well before full dark — headlights come on at dusk out there, and
    // waiting for the sky to finish going navy means driving through the
    // best-looking ten minutes of the cycle unlit.
    const k = Math.min(1, Math.max(0, night * 2.4));
    if (k === this.intensity) return;
    this.intensity = k;
    for (const light of this.lights) light.intensity = k * 26;
    for (const glow of this.glows) {
      (glow.material as THREE.MeshBasicMaterial).opacity = k * 0.85;
      glow.visible = k > 0.01;
    }
  }

  dispose() {
    for (const glow of this.glows) {
      glow.geometry.dispose();
      (glow.material as THREE.Material).dispose();
    }
    for (const light of this.lights) light.dispose();
  }
}
