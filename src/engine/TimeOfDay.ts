import * as THREE from 'three';

/**
 * Time-of-day, deliberately biased toward golden and blue hour (§4).
 *
 * The keyframes are not evenly spaced in real time. Midday occupies a sliver of
 * the cycle and the warm low-sun bands are stretched wide, so the world sits in
 * "slightly magic hour" almost always — that's the Firewatch trick, and it's a
 * scheduling decision rather than a colour-grading one.
 */
export interface SkyState {
  /** Sun elevation above the horizon, radians. Negative is below. */
  elevation: number;
  azimuth: number;
  sunColor: THREE.Color;
  sunIntensity: number;
  zenith: THREE.Color;
  horizon: THREE.Color;
  /** Sky-side hemisphere colour — the source of the cool shadow tint. */
  hemiSky: THREE.Color;
  /** Bounce off the sand. */
  hemiGround: THREE.Color;
  hemiIntensity: number;
  fog: THREE.Color;
  fogNear: number;
  fogFar: number;
  /**
   * How much dust is in the air, 0..1 — the shamal.
   *
   * This is a weather term, not a lighting one, and it's on the day curve
   * because that's how it behaves out there: the wind gets up through the
   * morning, the air is at its thickest through the afternoon, and the dust
   * settles overnight so dawn is the clearest hour of the day.
   */
  haze: number;
  /** The colour the dust washes the sky toward. */
  hazeColor: THREE.Color;
  /**
   * How much of the night sky is showing, 0..1. Drives the stars and the
   * headlights, and exists as its own term rather than being derived from sun
   * elevation because after dark the directional light is the *moon* — it is
   * high in the sky and the world is still dark, so elevation says nothing.
   */
  night: number;
}

interface Keyframe extends SkyState {
  at: number;
}

const key = (
  at: number,
  elevationDeg: number,
  azimuthDeg: number,
  sun: number,
  sunIntensity: number,
  zenith: number,
  horizon: number,
  hemiSky: number,
  hemiGround: number,
  hemiIntensity: number,
  fog: number,
  fogNear: number,
  fogFar: number,
  haze: number,
  hazeColor: number,
  night: number,
): Keyframe => ({
  at,
  elevation: (elevationDeg * Math.PI) / 180,
  azimuth: (azimuthDeg * Math.PI) / 180,
  sunColor: new THREE.Color(sun),
  sunIntensity,
  zenith: new THREE.Color(zenith),
  horizon: new THREE.Color(horizon),
  hemiSky: new THREE.Color(hemiSky),
  hemiGround: new THREE.Color(hemiGround),
  hemiIntensity,
  fog: new THREE.Color(fog),
  fogNear,
  fogFar,
  haze,
  hazeColor: new THREE.Color(hazeColor),
  night,
});

// at, elev, azim, sunCol, sunI, zenith, horizon, hemiSky, hemiGround, hemiI, fog, near, far, haze, hazeCol, night
//
// Zeniths are deliberately saturated blues. The sand, the fog and the low sun
// supply all the warmth this palette needs; if the sky joins in, every frame
// turns monochrome peach and the dunes stop reading against it. The haze term
// then takes some of that blue back out over the course of the day — which is
// the point of having authored it saturated in the first place: there has to be
// something for the dust to wash out.
const KEYFRAMES: Keyframe[] = [
  // Deep night. The directional light here is the MOON, not the sun — high,
  // cold and weak — which is why it still casts (soft, blue, barely there)
  // while the world reads as dark. A night with no key light at all is flat
  // and unreadable, and the one thing this game cannot afford is a stretch
  // where the player can't see the dune in front of them.
  key(0.00, 38, 20, 0x9fb4de, 0.30, 0x050a1e, 0x1c2544, 0x2b3c72, 0x151726, 0.50, 0x1b2440, 70, 560, 0.06, 0x39405c, 1.00),
  // Blue hour, pre-dawn. Deep navy, sun still below the horizon, air at its
  // clearest — the night has had hours to drop what the wind put up.
  key(0.05, -4, 70, 0x5a6d9e, 0.25, 0x111a3c, 0x53506e, 0x3d4c86, 0x2e2b3f, 0.85, 0x54506c, 90, 620, 0.10, 0x6b6d84, 0.45),
  // Sunrise: the sun cracks the horizon and everything goes amber.
  key(0.10, 4, 78, 0xffab5e, 2.10, 0x1e3f80, 0xe0925c, 0x6f89c4, 0x8a6440, 1.00, 0xd68f60, 130, 790, 0.16, 0xd6a887, 0.00),
  // Morning gold — a wide, generous band. The wind is starting to get up.
  key(0.24, 20, 95, 0xffd39a, 2.30, 0x2f6ec4, 0xe8b98a, 0x89a6d6, 0xb08355, 1.05, 0xe3b184, 180, 920, 0.26, 0xdcc3a2, 0.00),
  // Midday. Kept short and never fully neutral; this is the least interesting light.
  key(0.42, 62, 150, 0xfff3dd, 2.00, 0x3f92e2, 0xd8cbb2, 0x9dbde2, 0xbf9a6e, 1.10, 0xd6c8ae, 240, 1010, 0.44, 0xd9cdb6, 0.00),
  // Afternoon: the shamal at full strength, and the haziest hour of the day.
  // The far dunes go flat and pale and the horizon stops having an edge.
  key(0.60, 30, 225, 0xffd9a4, 2.25, 0x3574c6, 0xe3b48b, 0x8caad8, 0xb4855a, 1.05, 0xdfae86, 190, 880, 0.56, 0xdcc4a0, 0.00),
  // The hero light. Long shadows, saturated sand, indigo in the lee faces.
  key(0.76, 9, 250, 0xffb26b, 2.45, 0x2455a8, 0xeaa367, 0x7593cc, 0x9c6e44, 0.95, 0xe09a64, 140, 800, 0.46, 0xd8b184, 0.00),
  // Sunset proper. Dust in the air is what makes this hour the colour it is.
  key(0.87, 1, 262, 0xff8c4a, 1.70, 0x18367c, 0xdd7d52, 0x5f78b6, 0x7a5238, 0.90, 0xcf7d55, 110, 690, 0.34, 0xc98f68, 0.12),
  // Blue hour, dusk — mirrors the opening so the loop is seamless.
  key(0.95, -5, 270, 0x6274a6, 0.30, 0x13204a, 0x585d7a, 0x42518c, 0x312e43, 0.85, 0x585472, 90, 640, 0.18, 0x70718a, 0.50),
];

const DAY_LENGTH_SECONDS = 20 * 60;

export class TimeOfDay {
  /**
   * Normalised 0..1 through the cycle. Defaults into the late-afternoon band:
   * the 0.76 hero keyframe is only 9° above the horizon, which is gorgeous on
   * dune faces but leaves flat ground grazed and murky.
   */
  time = 0.68;
  autoAdvance = false;

  readonly state: SkyState = {
    elevation: 0,
    azimuth: 0,
    sunColor: new THREE.Color(),
    sunIntensity: 1,
    zenith: new THREE.Color(),
    horizon: new THREE.Color(),
    hemiSky: new THREE.Color(),
    hemiGround: new THREE.Color(),
    hemiIntensity: 1,
    fog: new THREE.Color(),
    fogNear: 100,
    fogFar: 800,
    haze: 0,
    hazeColor: new THREE.Color(),
    night: 0,
  };

  constructor() {
    this.evaluate();
  }

  update(dt: number) {
    if (this.autoAdvance) {
      this.time = (this.time + dt / DAY_LENGTH_SECONDS) % 1;
    }
    this.evaluate();
  }

  /** World-space unit vector pointing *toward* the sun. */
  sunDirection(out: THREE.Vector3): THREE.Vector3 {
    const { elevation, azimuth } = this.state;
    const cosE = Math.cos(elevation);
    return out.set(
      cosE * Math.sin(azimuth),
      Math.sin(elevation),
      cosE * Math.cos(azimuth),
    ).normalize();
  }

  /**
   * Recomputes the sky state from `time`. Public because setting the time is
   * something the menu does directly — `update` only re-evaluates on the next
   * frame, and a jump to sunset that takes a frame to land looks like a bug.
   */
  evaluate() {
    const t = ((this.time % 1) + 1) % 1;

    let a = KEYFRAMES[KEYFRAMES.length - 1];
    let b = KEYFRAMES[0];
    let span = 1 - a.at + b.at;
    let local = t >= a.at ? t - a.at : 1 - a.at + t;

    for (let i = 0; i < KEYFRAMES.length - 1; i++) {
      if (t >= KEYFRAMES[i].at && t < KEYFRAMES[i + 1].at) {
        a = KEYFRAMES[i];
        b = KEYFRAMES[i + 1];
        span = b.at - a.at;
        local = t - a.at;
        break;
      }
    }

    // Smoothstep between keyframes so the light never visibly "ticks" over.
    const raw = span > 0 ? local / span : 0;
    const k = raw * raw * (3 - 2 * raw);

    const s = this.state;
    s.elevation = lerp(a.elevation, b.elevation, k);
    s.azimuth = lerp(a.azimuth, b.azimuth, k);
    s.sunIntensity = lerp(a.sunIntensity, b.sunIntensity, k);
    s.hemiIntensity = lerp(a.hemiIntensity, b.hemiIntensity, k);
    s.fogNear = lerp(a.fogNear, b.fogNear, k);
    s.fogFar = lerp(a.fogFar, b.fogFar, k);
    s.haze = lerp(a.haze, b.haze, k);
    s.night = lerp(a.night, b.night, k);
    s.hazeColor.copy(a.hazeColor).lerp(b.hazeColor, k);
    s.sunColor.copy(a.sunColor).lerp(b.sunColor, k);
    s.zenith.copy(a.zenith).lerp(b.zenith, k);
    s.horizon.copy(a.horizon).lerp(b.horizon, k);
    s.hemiSky.copy(a.hemiSky).lerp(b.hemiSky, k);
    s.hemiGround.copy(a.hemiGround).lerp(b.hemiGround, k);
    s.fog.copy(a.fog).lerp(b.fog, k);
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
