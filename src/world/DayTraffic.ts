import * as THREE from 'three';
import { WIND_X, WIND_Z } from '../terrain/height';
import { buildAnonymousBody } from './Convoys';
import {
  emptyRoutePoint, routeGround, routeLead, routeScale, sampleRoute,
  type Route, type RoutePoint,
} from './routes';

/**
 * Other people, in daylight.
 *
 * The night convoys gave the dark somebody else in it, and the day had nothing
 * equivalent — which left Ahmed radioing about "the dune-bashing traffic in his
 * patch" over an empty desert for two thirds of the cycle.
 *
 * ## Why a plume rather than a vehicle
 *
 * At night the readable thing is the lamp: a headlight is a point source and
 * carries for kilometres. In daylight the readable thing is the *dust*. A 4x4
 * at 800m is a few pixels of dark grey against pale sand and reads as nothing;
 * the column of dust it drags is thirty metres tall, sunlit, and visible from
 * far further than the vehicle that made it. Anyone who has been out there
 * recognises it instantly, and that recognition is doing all the work.
 *
 * So the vehicle is modelled at true scale and is effectively invisible until
 * you get close — same bargain the convoys strike — and the plume is what you
 * actually see. Get close anyway and you find a plain dark 4x4 driving along,
 * which is the honest answer to "what is that".
 *
 * ## Against the solitude
 *
 * §1 is built on being alone out there, and this is the system most able to
 * spoil it, so the restraint is in the placement rather than in the rendering.
 * Every route sits well outside the POI ring, the plumes are drawn but never
 * heard, and nothing about them asks the player to do anything. You are not
 * meant to catch them, and there is nothing there if you do.
 */

/** Metres between vehicles. Wider than the night convoys: in daylight you can
 *  see far enough ahead not to drive in someone's dust. */
const SPACING = 34;
/** Below this much daylight, the night convoys have it. */
const DAY_ON = 0.3;

/** Puffs trailing each vehicle. The plume's whole length is PUFFS * PUFF_DT
 *  seconds of driving, so at 12 m/s eighteen puffs is a ~120m tail. */
const PUFFS = 18;
const PUFF_DT = 0.55;
/** Metres per second the column climbs as it ages. */
const RISE = 1.35;
/** How far the shamal pushes a puff sideways per second of age. */
const DRIFT = 1.9;
/** A puff starts about this wide and opens out as it goes. */
const SIZE_NEW = 2.4;
const SIZE_GROWTH = 3.1;
/**
 * Opacity at the head of the plume, thinning to nothing at the tail.
 *
 * Higher than it sounds, and it has to be. These are seen at 300m through the
 * scene fog, which is already eating most of the contrast before the alpha is
 * applied — the first pass at 0.24 measured 0.137 on screen after the haze
 * factor and simply was not there.
 */
const PEAK_ALPHA = 0.62;

/**
 * Distance fade at the near end. Below `NEAR_GONE` a puff is invisible; by
 * `NEAR_FULL` it is at full strength.
 *
 * These plumes are meant to be read from hundreds of metres away, and the sizes
 * are set for that — the oldest puff in a tail is 26m across. Drive up to one
 * and those discs are camera-facing sheets filling the screen, which reads as
 * broken geometry rather than as dust.
 */
const NEAR_GONE = 22;
const NEAR_FULL = 90;

/**
 * Three daytime runs, all outside the POI ring and none near another. Closer
 * in than the night convoys — a plume has to be resolvable to read as a plume,
 * where a headlight only has to be a bright dot — but never close enough to
 * feel like company.
 */
const ROUTES: Route[] = [
  { cx: -380, cz: 300, major: 300, minor: 52, bearing: 2.7, count: 3, speed: 13, phase: 0.7, direction: 1 },
  { cx: 430, cz: 120, major: 260, minor: 40, bearing: 1.35, count: 2, speed: 15, phase: 2.6, direction: -1 },
  { cx: -60, cz: -470, major: 330, minor: 64, bearing: 0.25, count: 4, speed: 11, phase: 4.1, direction: 1 },
];

export class DayTraffic {
  readonly group = new THREE.Group();

  private bodies: THREE.InstancedMesh;
  private puffs: THREE.InstancedMesh;
  private bodyGeo: THREE.BufferGeometry;
  private puffGeo: THREE.CircleGeometry;
  private bodyMat: THREE.MeshLambertMaterial;
  private puffMat: THREE.MeshBasicMaterial;
  /** Per-puff opacity. `setColorAt` cannot carry this — three's instanceColor
   *  is RGB — and scaling the colour instead just renders dark discs. */
  private alphaAttr: THREE.InstancedBufferAttribute;

  private dummy = new THREE.Object3D();
  private tint = new THREE.Color();
  private point: RoutePoint = emptyRoutePoint();
  private tail = { x: 0, y: 0, z: 0 };
  private t = 0;
  private routes = ROUTES.length;

  private static readonly MAX_VEHICLES = ROUTES.reduce((n, r) => n + r.count, 0);

  constructor() {
    this.bodyGeo = buildAnonymousBody(0x7d6b58);
    this.bodyMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.bodies = new THREE.InstancedMesh(this.bodyGeo, this.bodyMat, DayTraffic.MAX_VEHICLES);
    this.bodies.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.bodies.frustumCulled = false;
    this.bodies.castShadow = false;

    this.puffGeo = new THREE.CircleGeometry(1, 7);
    this.puffMat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 1,
      depthWrite: false,
      // Normal blending, unlike the night lamps. Dust in daylight is lit sand
      // in the air — it occludes what is behind it. Additive would make a plume
      // brighten the dune it is standing in front of.
      //
      // That choice is what forces the alpha attribute below. The convoys fade
      // a lamp by scaling its colour, which works because additive blending
      // reads a dark colour as "not there". Under normal blending the same
      // scaling reads as "there, and black".
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
    });
    this.puffMat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aAlpha;\nvarying float vAlpha;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAlpha = aAlpha;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vAlpha;')
        // Last chunk in the basic material's fragment shader, so nothing
        // downstream overwrites the alpha again.
        .replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.a *= vAlpha;');
    };
    this.alphaAttr = new THREE.InstancedBufferAttribute(
      new Float32Array(DayTraffic.MAX_VEHICLES * PUFFS), 1,
    );
    this.alphaAttr.setUsage(THREE.DynamicDrawUsage);
    this.puffGeo.setAttribute('aAlpha', this.alphaAttr);
    this.puffs = new THREE.InstancedMesh(
      this.puffGeo, this.puffMat, DayTraffic.MAX_VEHICLES * PUFFS,
    );
    this.puffs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.puffs.frustumCulled = false;
    // Behind the player's own dust, which is nearer and should win.
    this.puffs.renderOrder = 7;

    this.group.add(this.bodies, this.puffs);
    this.group.visible = false;
  }

  /** Number of routes to run. Zero switches the system off entirely. */
  setRoutes(n: number) {
    this.routes = Math.max(0, Math.min(ROUTES.length, n));
  }

  /**
   * @param night 0..1 off the day curve — this is the inverse of the convoys.
   * @param sunColor the day's own light, so a plume at golden hour is orange
   *   and one at noon is white, without this system knowing what time it is.
   * @param haze 0..1 from the weather. A shamal is the one condition where
   *   somebody else's dust genuinely stops being visible.
   */
  update(
    dt: number,
    night: number,
    camera: THREE.Vector3,
    sunColor: THREE.Color,
    haze: number,
  ) {
    const day = 1 - night;
    const on = day > DAY_ON && this.routes > 0 && haze < 0.85;
    this.group.visible = on;
    if (!on) return;

    // Eased at both ends: they thin out into dusk rather than vanishing, and
    // they are already gone by the time the first headlights appear.
    //
    // The haze term is a threshold, not a scale. Liwa's *baseline* haze sits
    // near 0.5 on a clear day, so a linear `1 - haze` was quietly halving every
    // plume all the time and the whole system rendered at an alpha of 0.13 —
    // present in the buffer, invisible on screen. Only a real shamal should
    // take them out.
    const storm = smoothstep(0.55, 0.88, haze);
    const fade = Math.min(1, (day - DAY_ON) / 0.25) * (1 - storm);
    this.t += dt;

    const windLen = Math.hypot(WIND_X, WIND_Z) || 1;
    const wx = WIND_X / windLen;
    const wz = WIND_Z / windLen;

    let v = 0;
    let p = 0;
    for (let r = 0; r < this.routes; r++) {
      const route = ROUTES[r];
      const mean = routeScale(route);
      const lead = routeLead(route, this.t);

      for (let i = 0; i < route.count; i++) {
        const u = lead - (i * SPACING * route.direction) / mean;
        const car = sampleRoute(route, u, this.point);

        this.dummy.position.set(car.x, car.y, car.z);
        this.dummy.rotation.set(car.pitch, car.yaw, 0, 'YXZ');
        this.dummy.scale.setScalar(1);
        this.dummy.updateMatrix();
        this.bodies.setMatrixAt(v++, this.dummy.matrix);

        for (let k = 0; k < PUFFS; k++) {
          const age = k * PUFF_DT;
          // Where the vehicle *was* that many seconds ago, on the same path.
          // Reading the route backwards rather than keeping a ring buffer of
          // past positions means a plume is correct the instant the system
          // switches on, instead of growing in over ten seconds every dawn.
          const back = u - (age * route.speed * route.direction) / mean;
          routeGround(route, back, this.tail);

          const t01 = k / (PUFFS - 1);
          this.dummy.position.set(
            this.tail.x + wx * DRIFT * age,
            this.tail.y + 0.7 + RISE * age,
            this.tail.z + wz * DRIFT * age,
          );
          this.dummy.lookAt(camera);
          // How close this puff is to the eye. A 26m camera-facing disc a few
          // metres away is a translucent wall across the screen, and driving up
          // to a plume is exactly what a player does once they notice one.
          const near = Math.hypot(
            this.dummy.position.x - camera.x,
            this.dummy.position.y - camera.y,
            this.dummy.position.z - camera.z,
          );
          this.dummy.scale.setScalar(SIZE_NEW + SIZE_GROWTH * age);
          this.dummy.updateMatrix();
          this.puffs.setMatrixAt(p, this.dummy.matrix);

          // Thin, and thinning fast. A plume is mostly air: the density that
          // reads correctly is far lower than it feels like it should be.
          this.alphaAttr.setX(
            p,
            (1 - t01) ** 1.05 * PEAK_ALPHA * fade * smoothstep(NEAR_GONE, NEAR_FULL, near),
          );
          // Colour is the dust itself, unscaled — the fade lives in the alpha.
          this.tint.copy(sunColor).lerp(SAND, 0.45);
          this.puffs.setColorAt(p, this.tint);
          p++;
        }
      }
    }

    this.bodies.count = v;
    this.puffs.count = p;
    this.bodies.instanceMatrix.needsUpdate = true;
    this.puffs.instanceMatrix.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
    if (this.puffs.instanceColor) this.puffs.instanceColor.needsUpdate = true;
  }

  dispose() {
    this.bodyGeo.dispose();
    this.puffGeo.dispose();
    this.bodyMat.dispose();
    this.puffMat.dispose();
    this.bodies.dispose();
    this.puffs.dispose();
  }
}

/** What the dust is made of, mixed into the sun's own colour. */
const SAND = new THREE.Color(0xd8b184);

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
