import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { SceneRig } from './Scene';
import { ChaseCamera } from './ChaseCamera';
import { TimeOfDay } from './TimeOfDay';
import { TerrainStreamer } from '../terrain/TerrainStreamer';
import { heightAt, softnessAt } from '../terrain/height';
import { Vehicle } from '../vehicle/Vehicle';
import { createVehicleView, type VehicleView } from '../vehicle/vehicleMesh';
import { DustSystem } from '../vehicle/DustSystem';
import { ContactShadow } from '../vehicle/ContactShadow';
import { TrackSystem } from '../vehicle/TrackSystem';
import { Headlights } from '../vehicle/Headlights';
import { InputManager } from '../input/InputManager';
import { haptics } from '../input/Haptics';
import { emptyInput } from '../input/types';
import { DebugHud } from '../ui/DebugHud';
import { TuningPanel } from '../ui/TuningPanel';
import { GaragePanel } from '../ui/GaragePanel';
import { CarSelect } from '../ui/CarSelect';
import { MenuPanel } from '../ui/MenuPanel';
import { BODY_TUNING } from '../vehicle/vehicleConfig';
import {
  PRESSURE_RATE, PRESSURE_STEPS, pressureAxis, pressureTuning, psiAt, softnessScale,
  type PressureId,
} from '../vehicle/tyrePressure';
import { loadSettings, saveSettings, type GameSettings } from '../settings/Settings';
import { GameAudio } from '../audio/GameAudio';
import { Director } from '../narrative/Director';
import { RadioSubtitles } from '../narrative/RadioSubtitles';
import { createLandmarks, createLandmarkColliders } from '../world/Landmarks';
import { WorldBoundary } from './WorldBoundary';
import { Scatter } from '../world/Scatter';
import { Birds } from '../world/Birds';
import { Wildlife } from '../world/Wildlife';
import { SandPlumes, windFromHaze } from '../world/SandPlumes';
import { Avalanche } from '../world/Avalanche';
import { createOldTracks } from '../world/OldTracks';
import { Weather } from '../world/Weather';
import { Camels } from '../world/Camels';
import { Convoys } from '../world/Convoys';
import { createDiscoveries } from '../world/Discoveries';
import { airborneSand } from '../terrain/chunkGeometry';
import { PROFILES, QualityWatchdog, detectTier, type QualityTier } from './Quality';
import { PhotoMode } from './PhotoMode';
import { GAME_NAME, GAME_TAGLINE, GAME_URL } from '../brand';
import { PhotoBar } from '../ui/PhotoBar';
import { Compass } from '../ui/Compass';
import { PoiCard } from '../ui/PoiCard';
import { loadProgress, saveProgress, type Progress } from '../settings/Progress';
import type { PoiKind } from '../data/pois';
import { activeRegion, setActiveRegion, type RegionId } from '../terrain/regions';
import { refreshRegion } from '../terrain/height';

const PHYSICS_HZ = 60;
const FIXED_DT = 1 / PHYSICS_HZ;
/** Cap catch-up work so a background tab doesn't return to a physics avalanche. */
const MAX_SUBSTEPS = 5;
/** Where a boundary respawn sets the truck back down, well inside the fade edge. */
const RESPAWN_RADIUS = 680;

export class Game {
  private rig: SceneRig;
  private world: RAPIER.World;
  private terrain: TerrainStreamer;
  private timeOfDay = new TimeOfDay();
  private vehicle: Vehicle;
  private view: VehicleView;
  private dust = new DustSystem();
  private contactShadow = new ContactShadow();
  private tracks = new TrackSystem();
  private scatter = new Scatter();
  private birds = new Birds();
  private wildlife = new Wildlife();
  private plumes = new SandPlumes();
  private avalanche = new Avalanche();
  private weather = new Weather();
  private camels = new Camels();
  private convoys = new Convoys();
  private headlights = new Headlights();
  private chase: ChaseCamera;
  private input: InputManager;
  private hud: DebugHud;
  private panel: TuningPanel;
  private garage: GaragePanel;
  private carSelect: CarSelect;
  private menu: MenuPanel;
  /**
   * True until the player has picked a truck. Gates input rather than the
   * render loop, so the world is live and lit behind the picker and the car
   * they are choosing is the actual car, under the actual light.
   */
  private choosing = true;
  private baseTuning: Record<string, number>;
  private previewAngle = 2.1;
  /**
   * Where the tyres actually are on the sand..road axis right now, which chases
   * the chosen setting rather than snapping to it. A compressor takes time, and
   * that pause is most of what makes airing down feel like an act you performed
   * rather than a menu item you toggled.
   */
  private pressureAxisNow = 1;
  private settings: GameSettings;
  private audio = new GameAudio();
  private subtitles = new RadioSubtitles();
  private director: Director;
  private photo: PhotoMode;
  private photoBar: PhotoBar;
  private boundary = new WorldBoundary();
  private compass = new Compass();
  private poiCard = new PoiCard();
  private activePoi: PoiKind | null = null;
  private progress: Progress;
  private forward = new THREE.Vector3();
  private watchdog = new QualityWatchdog();
  private tier: QualityTier;
  private captureNextFrame = false;
  private pendingShare = false;
  /** Fed to the vehicle in photo mode so the truck settles and stays put. */
  private frozenInput = emptyInput();

  private accumulator = 0;
  private lastTime = 0;
  private running = false;

  // Previous/current physics transforms, so rendering can interpolate between
  // fixed steps instead of stuttering on high-refresh displays.
  private prevPos = new THREE.Vector3();
  private prevQuat = new THREE.Quaternion();
  private curPos = new THREE.Vector3();
  private curQuat = new THREE.Quaternion();
  private renderPos = new THREE.Vector3();
  private renderQuat = new THREE.Quaternion();
  private sunDir = new THREE.Vector3();
  private dustColor = new THREE.Color();
  private slumpColor = new THREE.Color();
  private airborneColor = new THREE.Color();
  /**
   * Everything built once from the region's data: landmarks, discoverables, old
   * tracks. Held in one group so a region change is "empty this and refill it"
   * rather than a list of removals that will be forgotten the next time
   * something is added to the world.
   */
  private worldProps = new THREE.Group();
  private landmarkColliders: RAPIER.Collider[] = [];

  private constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.rig = new SceneRig(canvas);
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.integrationParameters.dt = FIXED_DT;

    // Settings first, and specifically before anything samples the height
    // field: the region decides what `heightAt` *is*, so loading it later would
    // spawn the truck at Liwa's ground level in Fossil Rock's terrain.
    this.settings = loadSettings();
    // Before the first applyBodyTuning: the tyres start where the player left
    // them, rather than at road pressure and audibly deflating on load.
    this.pressureAxisNow = pressureAxis(this.settings.tyrePressure);
    setActiveRegion(this.settings.region);
    refreshRegion();

    const spawn = { x: 0, y: heightAt(0, 0) + 2.0, z: 0 };

    this.terrain = new TerrainStreamer(RAPIER, this.world);
    this.rig.scene.add(this.terrain.group);
    // Ground and horizon must both exist before the first frame is simulated.
    this.terrain.preload(spawn.x, spawn.z);

    // The query pipeline is what wheel raycasts hit, and it is only rebuilt by
    // `world.step()`. Prime it so the first vehicle update finds ground instead
    // of dropping the truck through the world.
    this.world.queryPipeline.update(this.world.colliders);

    const check = this.terrain.verifyAlignment(spawn.x, spawn.z);
    if (check.ok) {
      console.info(`[dune] terrain aligned (max error ${check.worstError.toFixed(3)}m)`);
    } else {
      console.warn(
        `[dune] terrain colliders disagree with the height field by ${check.worstError.toFixed(2)}m` +
        ' — check the chunk sample layout or collider translation',
      );
    }

    this.vehicle = new Vehicle(RAPIER, this.world, spawn);
    // The tuned baseline, captured before any body override touches it. This is
    // what §2's "tuned by feel" produced, and the per-body deltas are read as
    // departures from it rather than becoming the new normal.
    this.baseTuning = { ...this.vehicle.tuning };
    // The body and paint the player last chose are part of the very first
    // frame, so there's no moment where someone's pickup appears as the default
    // wagon and then swaps.
    this.view = createVehicleView(this.settings.vehicle);
    // Parented to the body, so the beams sweep with the truck — including the
    // pitch and roll, which is most of what makes night driving feel different.
    this.view.root.add(this.headlights.group);
    this.rig.scene.add(this.view.root);
    this.rig.scene.add(this.tracks.mesh);
    this.rig.scene.add(this.contactShadow.mesh);
    this.rig.scene.add(this.dust.points);

    this.worldProps.add(createLandmarks());
    // Solid, damage-free colliders for those same landmarks (§11).
    this.landmarkColliders = createLandmarkColliders(RAPIER, this.world);
    this.rig.scene.add(this.worldProps);
    this.rig.scene.add(this.scatter.group);
    this.rig.scene.add(this.birds.mesh);
    this.rig.scene.add(this.wildlife.group);
    this.rig.scene.add(this.camels.group);
    this.rig.scene.add(this.convoys.group);
    // Junk in the sand. No colliders — small enough that a stop would read as
    // hitting an invisible box rather than as hitting a sandal.
    this.worldProps.add(createDiscoveries());
    this.rig.scene.add(this.plumes.points);
    this.rig.scene.add(this.avalanche.points);
    // Everyone who came before. Baked once, one draw call, never updated.
    this.worldProps.add(createOldTracks());
    // Fill the ground dressing around spawn before the first frame, so the
    // world doesn't visibly grow plants while the player is looking at it.
    for (let i = 0; i < 24; i++) this.scatter.update(spawn.x, spawn.z);

    this.progress = loadProgress();
    haptics.setEnabled(this.settings.haptics);
    this.audio.setMuted(this.settings.muted);
    this.audio.setVolume(this.settings.volume);
    this.audio.setMusicVolume(this.settings.musicVolume);
    this.audio.setEffectsVolume(this.settings.effectsVolume);
    this.director = new Director(
      this.subtitles,
      {
        // Ahmed has no voice (§6), so the static cue is the whole of his
        // presence — worth putting in the hand as well as the ear, since on a
        // phone in a noisy room the audio is the part most likely to be missed.
        onKeyUp: () => {
          this.audio.radioKeyUp();
          haptics.radioKeyUp();
        },
        onSignOff: () => {
          this.audio.radioSignOff();
          haptics.radioSignOff();
        },
      },
      (poi) => {
        // Discovery persists across sessions (§3); the compass stops nudging
        // toward it and the counter ticks up. Ahmed stays once-per-session.
        if (this.progress.discovered.has(poi.id)) return;
        this.progress.discovered.add(poi.id);
        saveProgress(this.progress);
      },
    );

    this.chase = new ChaseCamera(window.innerWidth / window.innerHeight);
    this.input = new InputManager(this.settings);
    this.hud = new DebugHud();
    this.panel = new TuningPanel(
      this.vehicle.tuning,
      this.settings,
      this.timeOfDay,
      () => this.vehicle.applyTuning(),
      () => {
        this.audio.setMuted(this.settings.muted);
        this.audio.setVolume(this.settings.volume);
        this.audio.setMusicVolume(this.settings.musicVolume);
        this.audio.setEffectsVolume(this.settings.effectsVolume);
      },
      () => {
        this.applyQuality(
          this.settings.quality === 'auto' ? detectTier() : this.settings.quality,
        );
      },
      () => this.applyTouchScheme(),
      () => {
        // One panel at a time: they share the same corner, and the garage is
        // worth seeing the truck next to rather than a wall of sliders.
        this.panel.hide();
        this.garage.show();
      },
    );
    this.garage = new GaragePanel(this.settings, () => this.rebuildVehicleView());
    this.menu = new MenuPanel({
      getRegion: () => activeRegion().id,
      getBody: () => this.settings.vehicle.body,
      getTime: () => this.timeOfDay.time,
      onRegion: (id) => {
        void this.changeRegion(id).then(() => this.menu.regionSettled());
      },
      onBody: (id) => {
        if (id === this.settings.vehicle.body) return;
        this.settings.vehicle.body = id;
        saveSettings(this.settings);
        this.applyBodyTuning();
        this.rebuildVehicleView();
      },
      onTime: (t) => {
        this.timeOfDay.time = t;
        this.timeOfDay.evaluate();
      },
      onStick: (pos) => {
        this.settings.joystickPosition = pos;
        saveSettings(this.settings);
        this.input.touch.setJoystickPosition(pos);
      },
      getStick: () => this.settings.joystickPosition,
      getPressure: () => this.settings.tyrePressure,
      onPressure: (id) => this.setPressure(id),
      getHaptics: () => this.settings.haptics,
      onHaptics: (on) => {
        this.settings.haptics = on;
        saveSettings(this.settings);
        haptics.setEnabled(on);
      },
      stickAvailable: () =>
        matchMedia('(pointer: coarse)').matches && this.settings.touchScheme === 'joystick',
    });
    this.menu.setVisible(false);
    this.carSelect = new CarSelect(this.settings.vehicle, () => {
      this.rebuildVehicleView();
      this.applyBodyTuning();
      saveSettings(this.settings);
    });

    this.photo = new PhotoMode(canvas);
    this.photoBar = new PhotoBar(
      this.photo,
      () => void this.savePhoto(false),
      () => void this.savePhoto(true),
      () => this.exitPhotoMode(),
    );

    this.tier = this.settings.quality === 'auto' ? detectTier() : this.settings.quality;
    this.applyQuality(this.tier);

    // Touch controls appear on touch-capable viewports; the picker only
    // interrupts once, on the first such session (§7).
    // Touch controls appear on touch-capable viewports; the scheme is always
    // the joystick now, so there is nothing to pick (§7).
    if (matchMedia('(pointer: coarse)').matches) {
      this.input.touch.show();
      this.applyTouchScheme();
    }

    uiRoot.append(
      this.hud.element,
      this.subtitles.element,
      this.input.touch.element,
      this.photoBar.element,
      this.panel.element,
      this.garage.element,
      this.boundary.element,
      this.compass.element,
      this.poiCard.element,
      this.carSelect.element,
      this.menu.button,
      this.menu.element,
    );

    // Browsers only allow audio to start from a real gesture, so the first
    // input of any kind unlocks it.
    // Not once:true — mobile browsers can reject the first resume/play and
    // permit a later one, so every gesture retries until audio is running.
    const unlock = () => { void this.audio.unlock(); };
    window.addEventListener('keydown', unlock);
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('touchend', unlock);

    this.vehicle.onRecover = (reason) => {
      if (reason === 'rollover') {
        this.director.onRollover();
        haptics.rollover();
      }
      // Camera snaps with the truck so the flip reads as a beat, not a cutaway.
      this.syncTransforms(true);
      this.chase.reset(this.curPos, this.curQuat);
      // A recovery can move the truck; without this a ribbon would stretch
      // across the gap as one enormous triangle.
      this.tracks.clear();
    };

    // The picker is the only thing on screen until it's dismissed. Speed
    // readout, compass and the key legend are all instructions for driving, and
    // showing them behind a menu is just noise over the truck being previewed.
    this.hud.element.hidden = true;
    this.compass.hide();
    document.body.classList.add('choosing-car');

    this.applyBodyTuning();

    this.syncTransforms(true);
    this.chase.reset(this.curPos, this.curQuat);
    this.onResize();
    window.addEventListener('resize', this.onResize);
  }

  static async create(canvas: HTMLCanvasElement, uiRoot: HTMLElement): Promise<Game> {
    await RAPIER.init();
    return new Game(canvas, uiRoot);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    requestAnimationFrame(this.frame);
  }

  /**
   * Folds the chosen body's handling overrides into the live tuning object.
   *
   * Rebuilt from the baseline every time rather than patched in place: applying
   * deltas cumulatively means switching pickup -> buggy -> pickup in the picker
   * leaves the truck carrying half of each, and the bug only shows up as "the
   * handling feels wrong sometimes", which is the worst kind to chase.
   */
  /**
   * Turntable for the picker: a slow orbit around the parked truck, tilted down
   * onto it, framing it against the dunes.
   *
   * Driven here rather than by nudging the chase camera's orbit input, because
   * that input is a *temporary* offset which eases itself back to centre — a
   * constant value settles at an angle instead of going round. This walks the
   * angle itself, so it never stops.
   */
  private orbitPreview(dt: number) {
    this.previewAngle += dt * 0.22;
    const cam = this.chase.camera;
    const radius = 8.4;
    const target = this.renderPos;
    cam.position.set(
      target.x + Math.sin(this.previewAngle) * radius,
      target.y + 2.5,
      target.z + Math.cos(this.previewAngle) * radius,
    );
    // Aimed a little above the sills so the car sits in the frame rather than
    // on its bottom edge, and never below the horizon.
    cam.lookAt(target.x, target.y + 0.55, target.z);
  }

  /**
   * Rebuilds the live tuning from three layers: the tuned baseline, the body's
   * overrides, then tyre pressure on top of both.
   *
   * Always from the baseline, never patched in place. Pressure is now a
   * continuously-moving multiplier, so applying it cumulatively would compound
   * a few percent every frame while the tyres are changing and quietly leave
   * the truck with a top speed of nothing.
   */
  private applyBodyTuning() {
    Object.assign(this.vehicle.tuning, this.baseTuning);
    Object.assign(this.vehicle.tuning, BODY_TUNING[this.settings.vehicle.body]);
    Object.assign(this.vehicle.tuning, pressureTuning(this.vehicle.tuning, this.pressureAxisNow));
    this.vehicle.tyreSoftnessScale = softnessScale(this.pressureAxisNow);
    this.vehicle.applyTuning();
  }

  /** Step the tyres one notch toward sand (-1) or road (+1). */
  setPressureStep(delta: number) {
    const i = PRESSURE_STEPS.findIndex((s) => s.id === this.settings.tyrePressure);
    const next = PRESSURE_STEPS[Math.max(0, Math.min(PRESSURE_STEPS.length - 1, i + delta))];
    this.setPressure(next.id);
  }

  setPressure(id: PressureId) {
    if (id === this.settings.tyrePressure) return;
    this.settings.tyrePressure = id;
    saveSettings(this.settings);
    this.director.onTyrePressure(id);
    haptics.tyres();
  }

  /** Walks the live axis toward the chosen setting, re-tuning as it goes. */
  private updatePressure(dt: number) {
    const target = pressureAxis(this.settings.tyrePressure);
    if (this.pressureAxisNow === target) return;
    const step = (dt / PRESSURE_RATE) * (PRESSURE_STEPS.length - 1);
    const delta = target - this.pressureAxisNow;
    this.pressureAxisNow =
      Math.abs(delta) <= step ? target : this.pressureAxisNow + Math.sign(delta) * step;
    this.applyBodyTuning();
  }

  /** Live psi, for the dash readout. Read-only. */
  get psi(): number {
    return psiAt(this.pressureAxisNow);
  }

  /**
   * Shows the truck picker and resolves once the player commits.
   *
   * Called after `start()` on purpose: the render loop is already running, so
   * the desert is live behind the panel and every change previews on the real
   * vehicle in real light. Input stays frozen throughout (see `choosing`).
   *
   * The region was chosen before this object existed — see main.ts, where the
   * map picker doubles as the loading screen — so by the time the truck is
   * being framed it is already standing in the right desert.
   */
  async chooseCar(): Promise<void> {
    await this.carSelect.open();
    this.choosing = false;
    saveSettings(this.settings);

    this.hud.element.hidden = false;
    this.compass.show();
    this.menu.setVisible(true);
    document.body.classList.remove('choosing-car');
    // The camera has been sitting on a parked truck; hand it over cleanly rather
    // than letting the follow spring unwind from wherever the preview left it.
    this.chase.reset(this.curPos, this.curQuat);
  }

  private frame = (now: number) => {
    if (!this.running) return;
    requestAnimationFrame(this.frame);

    // Clamp the wall-clock delta: alt-tabbing must not teleport the truck.
    const frameDt = Math.min((now - this.lastTime) / 1000, 0.25);
    this.lastTime = now;

    this.input.update(frameDt);
    this.handleHotkeys();

    const drop = this.watchdog.sample(frameDt, this.tier, this.settings.quality !== 'auto');
    if (drop) {
      console.info(`[dune] frame time sustained above budget — quality ${this.tier} -> ${drop}`);
      this.applyQuality(drop);
    }

    // Frozen while the picker is up for the same reason as photo mode: the
    // truck is on screen and being looked at, and a stray key would drive it
    // out of its own preview.
    const controls = this.photo.active || this.choosing ? this.frozenInput : this.input.vehicle;

    this.accumulator += frameDt;
    let steps = 0;
    // A landing lasts one physics step. If several steps run in a frame the
    // touchdown can happen on any of them, so carry the strongest one out.
    let landingImpact = 0;
    while (this.accumulator >= FIXED_DT && steps < MAX_SUBSTEPS) {
      this.prevPos.copy(this.curPos);
      this.prevQuat.copy(this.curQuat);

      this.vehicle.update(controls, FIXED_DT);
      this.world.step();

      landingImpact = Math.max(landingImpact, this.vehicle.telemetry.landingImpact);
      this.syncTransforms(false);
      this.accumulator -= FIXED_DT;
      steps++;
    }
    if (steps === MAX_SUBSTEPS) this.accumulator = 0;

    // Soft world boundary: fade to haze as the player leaves the region and set
    // them back down facing the centre once fully faded. Skipped in photo mode,
    // where the truck is parked and the free camera can roam.
    if (!this.photo.active && this.boundary.update(this.curPos.x, this.curPos.z, frameDt)) {
      this.respawnTowardCentre();
      haptics.boundary();
    }

    const alpha = Math.min(1, this.accumulator / FIXED_DT);
    this.renderPos.lerpVectors(this.prevPos, this.curPos, alpha);
    this.renderQuat.slerpQuaternions(this.prevQuat, this.curQuat, alpha);

    this.view.root.position.copy(this.renderPos);
    this.view.root.quaternion.copy(this.renderQuat);
    this.view.update(this.vehicle.wheels);

    if (this.choosing) {
      this.orbitPreview(frameDt);
    } else if (this.photo.active) {
      this.photo.updateCamera(this.chase.camera, this.renderPos);
    } else {
      this.chase.update(
        this.renderPos,
        this.renderQuat,
        this.vehicle.telemetry,
        this.input.camera.orbit,
        frameDt,
      );
    }

    this.terrain.update(this.renderPos.x, this.renderPos.z);
    this.scatter.update(this.renderPos.x, this.renderPos.z);
    this.birds.update(frameDt, this.renderPos.x, this.renderPos.z);
    this.wildlife.update(frameDt, this.renderPos.x, this.renderPos.z);
    this.camels.update(frameDt, this.renderPos.x, this.renderPos.z);

    this.timeOfDay.update(frameDt);
    // The shamal, folded in after the day curve and before anything reads it,
    // so the sky, sun, fog and the crest plumes' wind all pick it up without
    // any of them knowing weather exists. Not gated on `choosing`: a storm
    // rolling in behind the car picker is a good first impression of the place.
    const weatherEvent = this.weather.update(frameDt);
    this.weather.apply(this.timeOfDay.state);
    if (weatherEvent && !this.choosing) this.director.onWeather(weatherEvent);
    this.timeOfDay.sunDirection(this.sunDir);
    this.rig.update(this.timeOfDay.state, this.sunDir, this.renderPos, this.chase.camera.position);

    // The sand shader runs off the same sun and weather as everything else.
    //
    // Sheen is a low-sun phenomenon: forward scatter needs the light coming at
    // the surface almost edge-on, and by noon there's nothing to scatter
    // *toward* the eye. Haze cuts it too — the beam it needs is the same one
    // dust takes out (SceneRig). Ripples just lose contrast in dust, since
    // they're read off shading and dust flattens shading.
    const sand = this.terrain.sand;
    const haze = this.timeOfDay.state.haze;
    sand.uSunDirection.value.copy(this.sunDir);
    sand.uSheenColor.value.copy(this.timeOfDay.state.sunColor);
    sand.uSheen.value = Math.max(0, 1 - Math.max(this.sunDir.y, 0) / 0.62) * (1 - 0.45 * haze);
    sand.uRippleStrength.value = 1 - 0.4 * haze;
    this.headlights.setNight(this.timeOfDay.state.night);
    // After the camera has been placed for this frame: the lamp glows are
    // billboards, and orienting them against last frame's camera makes them
    // visibly lag when you swing the view.
    this.convoys.update(frameDt, this.timeOfDay.state.night, this.chase.camera.position);

    // Airborne sand: lit by the sky, but tinted by the ground it came off.
    // Without the sand term the dust reads as pale smoke against red dunes.
    this.dustColor.copy(this.timeOfDay.state.sunColor).lerp(this.timeOfDay.state.horizon, 0.45);
    this.dustColor.lerp(airborneSand(this.airborneColor), 0.4);
    this.dust.setColor(this.dustColor);
    this.plumes.setColor(this.dustColor);
    // Sloughed sand is lit the same way, but it never left the ground, so it
    // keeps more of the dune's own colour and less of the sky's.
    this.avalanche.setColor(this.slumpColor.copy(this.dustColor).lerp(this.airborneColor, 0.45));
    // Same wind that drives the sky's haze, so the weather is one thing (§6).
    this.plumes.setStorm(this.weather.intensity);
    this.plumes.update(
      frameDt,
      this.renderPos.x,
      this.renderPos.z,
      windFromHaze(this.timeOfDay.state.haze),
    );

    // Ground-contact feedback. Both are driven off wheel contact points rather
    // than the body, so they mark where the truck actually meets the sand and
    // vanish the moment it doesn't.
    this.dust.emitFromWheels(
      this.vehicle.wheels,
      this.vehicle.telemetry.speed,
      frameDt,
      landingImpact,
    );
    this.dust.update(frameDt);
    // Sand letting go under the wheels on a slip face. Reads the same wheel
    // contacts the dust does, but keys off the *steepness* of the face rather
    // than the speed across it.
    this.avalanche.update(frameDt, this.vehicle.wheels, this.vehicle.telemetry.speed);
    this.contactShadow.update(this.vehicle.wheels, this.renderQuat, frameDt);
    // Rear wheels only: on a 4x4 the fronts run the same line, so laying all
    // four would just z-fight two ribbons against each other.
    this.tracks.update(this.vehicle.wheels, [2, 3], frameDt);

    // Heading from the truck's forward vector; the soft nudge points at the
    // nearest POI this player hasn't found yet, across sessions (§5).
    this.forward.set(0, 0, 1).applyQuaternion(this.renderQuat);
    const heading = Math.atan2(this.forward.x, this.forward.z);
    let targetBearing: number | null = null;
    let best = Infinity;
    for (const poi of activeRegion().pois) {
      if (this.progress.discovered.has(poi.id)) continue;
      const d = Math.hypot(poi.x - this.renderPos.x, poi.z - this.renderPos.z);
      if (d < best) {
        best = d;
        targetBearing = Math.atan2(poi.x - this.renderPos.x, poi.z - this.renderPos.z);
      }
    }
    this.compass.update(heading, targetBearing, this.progress.discovered.size, activeRegion().pois.length);

    // The arrival card: fades in inside a POI's radius, fades out on the way
    // off it. The exit edge is wider than the entry edge so idling right on the
    // boundary can't flicker the card.
    if (this.activePoi !== null) {
      const cur = activeRegion().pois.find((p) => p.id === this.activePoi)!;
      const d = Math.hypot(cur.x - this.renderPos.x, cur.z - this.renderPos.z);
      if (d > cur.radius * 1.35 || this.photo.active) {
        this.poiCard.hide();
        this.activePoi = null;
      }
    }
    if (this.activePoi === null && !this.photo.active) {
      for (const poi of activeRegion().pois) {
        if (Math.hypot(poi.x - this.renderPos.x, poi.z - this.renderPos.z) > poi.radius) continue;
        this.activePoi = poi.id;
        this.poiCard.show(poi);
        // A nudge to look up. On a phone the card arrives in the corner of a
        // screen you're steering with, and this is what makes it noticed. If
        // Ahmed is keying up about the same place in the same instant, the
        // priority check drops one of the two rather than stacking them.
        haptics.arrive();
        break;
      }
    }

    this.updatePressure(frameDt);
    // Arms Ahmed's one instructional line, which he only ever gets to use if
    // the player is genuinely bogged *and* has never aired down.
    const tel = this.vehicle.telemetry;
    if (!this.choosing && tel.speedKph < 4 && tel.wheelsOnGround >= 3 && tel.surfaceSoftness > 0.3) {
      this.director.noteBogged(this.settings.tyrePressure);
    }
    this.audio.update(this.vehicle.telemetry, controls.throttle, frameDt);
    // Fed the same telemetry and the same landing number the dust is, so what
    // you feel and what you see are one event rather than two systems agreeing.
    haptics.land(landingImpact);
    haptics.update(this.vehicle.telemetry, this.vehicle.wheels, controls.throttle, frameDt);
    // Ahmed holds off until the player is actually driving. His sign-on is a
    // greeting to someone who has just set out, and firing it over a menu spends
    // the one line that establishes him on a moment nobody is in yet.
    if (!this.choosing) {
      this.director.update(
        this.vehicle.telemetry,
        this.renderPos.x,
        this.renderPos.z,
        frameDt,
      );
    }
    this.subtitles.update(frameDt);

    if (this.photo.active) {
      this.photo.render(this.rig.renderer, this.rig.scene, this.chase.camera);
    } else {
      this.rig.renderer.render(this.rig.scene, this.chase.camera);
    }

    // Must be in the same task as the render, before the frame is composited.
    if (this.captureNextFrame) {
      this.captureNextFrame = false;
      void this.finishCapture(this.pendingShare);
    }

    this.hud.update(
      this.vehicle.telemetry,
      this.vehicle.wheels,
      this.terrain.stats,
      this.rig.renderer.info.render.calls,
      frameDt,
      this.psi,
    );
  };

  private handleHotkeys() {
    if (this.input.keyboard.consumePress('KeyT')) this.panel.toggle();
    if (this.input.keyboard.consumePress('KeyG')) this.garage.toggle();
    // Bracket keys, because pressure is an axis and direction matters — a
    // single cycling key makes you tap through road to get back to sand.
    if (this.input.keyboard.consumePress('BracketLeft')) this.setPressureStep(-1);
    if (this.input.keyboard.consumePress('BracketRight')) this.setPressureStep(1);
    if (this.input.keyboard.consumePress('KeyP')) this.togglePhotoMode();
    if (this.input.keyboard.consumePress('Escape') && this.photo.active) this.exitPhotoMode();
    // Recovering while composing a shot would yank the subject out of frame.
    if (!this.photo.active && this.input.keyboard.consumePress('KeyR')) {
      this.vehicle.recover('manual');
    }
    this.input.keyboard.endFrame();
  }

  private togglePhotoMode() {
    if (this.photo.active) this.exitPhotoMode();
    else this.enterPhotoMode();
  }

  private enterPhotoMode() {
    this.photo.enter(this.renderQuat);
    this.photoBar.show();
    // Photo mode is for looking at the truck, so nothing may sit over it.
    this.panel.hide();
    this.garage.hide();
    document.body.classList.add('photo-mode');
    this.hud.element.hidden = true;
    this.input.touch.element.hidden = true;
    this.compass.hide();
    this.menu.setVisible(false);
  }

  private exitPhotoMode() {
    this.photo.exit();
    this.photoBar.hide();
    document.body.classList.remove('photo-mode');
    this.hud.element.hidden = false;
    if (matchMedia('(pointer: coarse)').matches) this.input.touch.element.hidden = false;
    this.compass.show();
    this.menu.setVisible(true);
    this.chase.reset(this.curPos, this.curQuat);
  }

  private savePhoto(share: boolean) {
    // Deferred to just after the next render: the drawing buffer is cleared once
    // the frame is composited, so a capture taken at any other time is blank.
    this.pendingShare = share;
    this.captureNextFrame = true;
  }

  private async finishCapture(share: boolean) {
    const blob = await this.photo.capture();
    if (!blob) {
      this.photoBar.say('Could not capture');
      return;
    }
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const filename = `${GAME_NAME.toLowerCase()}-${stamp}.png`;
    const file = new File([blob], filename, { type: 'image/png' });

    if (share && navigator.canShare?.({ files: [file] })) {
      try {
        // Text and URL alongside the file, not just the file. Several share
        // targets drop one and keep the other, and a photo that arrives
        // somewhere with no way back to the game is the whole point missed.
        await navigator.share({
          files: [file],
          title: GAME_NAME,
          text: `${GAME_NAME} — ${GAME_TAGLINE}`,
          url: GAME_URL,
        });
        this.photoBar.say('Shared');
      } catch {
        // Includes the user dismissing the sheet, which isn't an error.
        this.photoBar.say('Share cancelled');
      }
      return;
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    this.photoBar.say('Saved');
  }

  /**
   * Swap the truck's mesh for the current garage config. Called only when the
   * player changes something — the merged bodywork is rebuilt from scratch
   * here, which is fine once per click and would be ruinous per frame.
   */
  private rebuildVehicleView() {
    this.rig.scene.remove(this.view.root);
    this.view.dispose();
    this.view = createVehicleView(this.settings.vehicle);
    // Placed and posed before it is added, so the new body never renders one
    // frame at the origin while the truck is out on a dune.
    this.view.root.position.copy(this.renderPos);
    this.view.root.quaternion.copy(this.renderQuat);
    // The headlights outlive the body — they belong to the truck, not to the
    // shell the player just swapped — so they get re-parented rather than
    // rebuilt. Missing this leaves someone who changes paint at night driving
    // in the dark for the rest of the session.
    this.view.root.add(this.headlights.group);
    this.view.update(this.vehicle.wheels);
    this.rig.scene.add(this.view.root);
  }

  private applyQuality(tier: QualityTier) {
    this.tier = tier;
    const profile = PROFILES[tier];
    this.rig.applyQuality(profile);
    this.terrain.setQuality(profile);
    this.dust.setMaxParticles(profile.maxDust);
    this.plumes.setMaxParticles(profile.maxPlumes);
    this.avalanche.setMaxGrains(profile.maxAvalanche);
    // Region bias on top of the quality tier: gravel plain carries noticeably
    // more scrub than deep sand does.
    this.scatter.setDensity(profile.scatterDensity * activeRegion().scatterBias);
    this.birds.setCount(profile.birds);
    this.wildlife.setCount(profile.gazelles);
    this.convoys.setRoutes(profile.convoys);
    this.watchdog.reset();
    this.onResize();
  }

  private applyTouchScheme() {
    this.input.touch.setScheme(this.settings.touchScheme);
    this.input.touch.setHandedness(this.settings.handedness);
    this.input.touch.setJoystickPosition(this.settings.joystickPosition);
  }

  /**
   * Set the truck back down inside the region, on the same bearing it left on but
   * facing the centre, so driving off the edge loops you gently back in. The full
   * haze is covering the screen at this instant, so the reposition is unseen.
   */
  /**
   * Tears the world down and rebuilds it in another region.
   *
   * There is no incremental path here and there shouldn't be: the height field
   * is a different function afterwards, so every chunk, collider, landmark,
   * baked track and cached scatter cell is describing a place that no longer
   * exists. The honest version is to drop all of it. That costs a visible
   * second, which is why the picker runs before the drive starts — this path is
   * for the menu, where a pause is expected.
   */
  async changeRegion(id: RegionId) {
    if (id === activeRegion().id) return;
    // Restored rather than cleared at the end: this is reachable from the menu
    // mid-drive, and also while another panel is holding input frozen.
    const wasChoosing = this.choosing;
    this.choosing = true;

    setActiveRegion(id);
    refreshRegion();

    // Props first: they hold colliders, and removing a collider after the world
    // has been stepped with it gone is a crash rather than a glitch.
    for (const c of this.landmarkColliders) this.world.removeCollider(c, false);
    this.landmarkColliders = [];
    disposeTree(this.worldProps);
    this.worldProps.clear();

    this.terrain.reset();
    this.scatter.reset();
    this.tracks.clear();
    this.progress = loadProgress();
    this.activePoi = null;
    this.poiCard.hide();
    this.director.reset();

    const spawn = { x: 0, z: 0 };
    this.terrain.preload(spawn.x, spawn.z);
    this.world.queryPipeline.update(this.world.colliders);

    this.worldProps.add(createLandmarks());
    this.landmarkColliders = createLandmarkColliders(RAPIER, this.world);
    this.worldProps.add(createDiscoveries());
    this.worldProps.add(createOldTracks());
    for (let i = 0; i < 24; i++) this.scatter.update(spawn.x, spawn.z);

    this.vehicle.warpTo(spawn.x, spawn.z, 0);
    this.syncTransforms(true);
    this.chase.reset(this.curPos, this.curQuat);
    this.applyQuality(this.tier);

    this.settings.region = id;
    saveSettings(this.settings);
    this.choosing = wasChoosing;
  }

  /** The active region's points of interest. Read-only, for tooling. */
  regionPois() {
    return activeRegion().pois;
  }

  /** Terrain height at a world point. Read-only, for tooling. */
  groundAt(x: number, z: number): number {
    return heightAt(x, z);
  }

  /** Surface softness at a world point, 0..1. Read-only, for tooling. */
  softnessAt(x: number, z: number): number {
    return softnessAt(x, z);
  }

  private respawnTowardCentre() {
    const p = this.curPos;
    const d = Math.hypot(p.x, p.z) || 1;
    const dirX = p.x / d;
    const dirZ = p.z / d;
    const rx = dirX * RESPAWN_RADIUS;
    const rz = dirZ * RESPAWN_RADIUS;
    // Forward is +Z in the truck's local frame; aim it back at the origin.
    const yaw = Math.atan2(-dirX, -dirZ);
    this.vehicle.warpTo(rx, rz, yaw);
    // Ground must exist before the next wheel raycast, and those raycasts read
    // the query pipeline as of the *last* step — stream the destination's
    // colliders now and prime the pipeline, exactly like startup does, or the
    // truck free-falls for the first steps after the warp.
    this.terrain.update(rx, rz);
    this.world.queryPipeline.update(this.world.colliders);
    this.syncTransforms(true);
    this.chase.reset(this.curPos, this.curQuat);
  }

  private syncTransforms(alsoPrevious: boolean) {
    const p = this.vehicle.position;
    const r = this.vehicle.rotation;
    this.curPos.set(p.x, p.y, p.z);
    this.curQuat.set(r.x, r.y, r.z, r.w);
    if (alsoPrevious) {
      this.prevPos.copy(this.curPos);
      this.prevQuat.copy(this.curQuat);
    }
  }

  private onResize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.rig.setSize(w, h);
    this.chase.setAspect(w / h);
    this.photo?.setSize(w, h, this.rig.renderer.getPixelRatio());
  };
}

/**
 * Frees every geometry and material under a node before it is discarded.
 *
 * Removing a group from the scene does not free its GPU buffers — three has no
 * finaliser and the driver keeps them alive as long as the JS objects exist. A
 * region change that skipped this would leak a whole world of terrain props on
 * every swap, which on a phone is a couple of swaps before the tab dies.
 */
function disposeTree(root: THREE.Object3D) {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    obj.geometry.dispose();
    const mat = obj.material;
    if (Array.isArray(mat)) for (const m of mat) m.dispose();
    else mat.dispose();
  });
}
