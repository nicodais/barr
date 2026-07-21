import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { SceneRig } from './Scene';
import { ChaseCamera } from './ChaseCamera';
import { TimeOfDay } from './TimeOfDay';
import { TerrainStreamer } from '../terrain/TerrainStreamer';
import { heightAt } from '../terrain/height';
import { Vehicle } from '../vehicle/Vehicle';
import { createVehicleView, type VehicleView } from '../vehicle/vehicleMesh';
import { DustSystem } from '../vehicle/DustSystem';
import { ContactShadow } from '../vehicle/ContactShadow';
import { TrackSystem } from '../vehicle/TrackSystem';
import { InputManager } from '../input/InputManager';
import { emptyInput } from '../input/types';
import { DebugHud } from '../ui/DebugHud';
import { TuningPanel } from '../ui/TuningPanel';
import { loadSettings, saveSettings, type GameSettings } from '../settings/Settings';
import { GameAudio } from '../audio/GameAudio';
import { Director } from '../narrative/Director';
import { RadioSubtitles } from '../narrative/RadioSubtitles';
import { createLandmarks } from '../world/Landmarks';
import { Scatter } from '../world/Scatter';
import { Birds } from '../world/Birds';
import { Wildlife } from '../world/Wildlife';
import { PROFILES, QualityWatchdog, detectTier, type QualityTier } from './Quality';
import { PhotoMode } from './PhotoMode';
import { PhotoBar } from '../ui/PhotoBar';
import { ControlPicker } from '../ui/ControlPicker';

const PHYSICS_HZ = 60;
const FIXED_DT = 1 / PHYSICS_HZ;
/** Cap catch-up work so a background tab doesn't return to a physics avalanche. */
const MAX_SUBSTEPS = 5;

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
  private chase: ChaseCamera;
  private input: InputManager;
  private hud: DebugHud;
  private panel: TuningPanel;
  private settings: GameSettings;
  private audio = new GameAudio();
  private subtitles = new RadioSubtitles();
  private director: Director;
  private photo: PhotoMode;
  private photoBar: PhotoBar;
  private picker: ControlPicker;
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

  private constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.rig = new SceneRig(canvas);
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.integrationParameters.dt = FIXED_DT;

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
    this.view = createVehicleView();
    this.rig.scene.add(this.view.root);
    this.rig.scene.add(this.tracks.mesh);
    this.rig.scene.add(this.contactShadow.mesh);
    this.rig.scene.add(this.dust.points);

    this.rig.scene.add(createLandmarks());
    this.rig.scene.add(this.scatter.group);
    this.rig.scene.add(this.birds.mesh);
    this.rig.scene.add(this.wildlife.group);
    // Fill the ground dressing around spawn before the first frame, so the
    // world doesn't visibly grow plants while the player is looking at it.
    for (let i = 0; i < 24; i++) this.scatter.update(spawn.x, spawn.z);

    this.settings = loadSettings();
    this.audio.setMuted(this.settings.muted);
    this.audio.setVolume(this.settings.volume);
    this.director = new Director(this.subtitles, {
      onKeyUp: () => this.audio.radioKeyUp(),
      onSignOff: () => this.audio.radioSignOff(),
    });

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
      },
      () => {
        this.applyQuality(
          this.settings.quality === 'auto' ? detectTier() : this.settings.quality,
        );
      },
      () => this.applyTouchScheme(),
    );

    this.photo = new PhotoMode(canvas);
    this.photoBar = new PhotoBar(
      this.photo,
      () => void this.savePhoto(false),
      () => void this.savePhoto(true),
      () => this.exitPhotoMode(),
    );
    this.picker = new ControlPicker((scheme, handedness) => {
      this.settings.touchScheme = scheme;
      this.settings.handedness = handedness;
      this.settings.touchPickerSeen = true;
      saveSettings(this.settings);
      this.applyTouchScheme();
      void this.audio.unlock();
    });

    this.tier = this.settings.quality === 'auto' ? detectTier() : this.settings.quality;
    this.applyQuality(this.tier);

    // Touch controls appear on touch-capable viewports; the picker only
    // interrupts once, on the first such session (§7).
    if (matchMedia('(pointer: coarse)').matches) {
      this.input.touch.show();
      this.applyTouchScheme();
      if (!this.settings.touchPickerSeen) {
        this.picker.open(this.settings.touchScheme, this.settings.handedness);
      }
    }

    uiRoot.append(
      this.hud.element,
      this.subtitles.element,
      this.input.touch.element,
      this.photoBar.element,
      this.panel.element,
      this.picker.element,
    );

    // Browsers only allow audio to start from a real gesture, so the first
    // input of any kind unlocks it.
    const unlock = () => { void this.audio.unlock(); };
    window.addEventListener('keydown', unlock, { once: true });
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('touchstart', unlock, { once: true });

    this.vehicle.onRecover = (reason) => {
      if (reason === 'rollover') this.director.onRollover();
      // Camera snaps with the truck so the flip reads as a beat, not a cutaway.
      this.syncTransforms(true);
      this.chase.reset(this.curPos, this.curQuat);
      // A recovery can move the truck; without this a ribbon would stretch
      // across the gap as one enormous triangle.
      this.tracks.clear();
    };

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

    const controls = this.photo.active ? this.frozenInput : this.input.vehicle;

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

    const alpha = Math.min(1, this.accumulator / FIXED_DT);
    this.renderPos.lerpVectors(this.prevPos, this.curPos, alpha);
    this.renderQuat.slerpQuaternions(this.prevQuat, this.curQuat, alpha);

    this.view.root.position.copy(this.renderPos);
    this.view.root.quaternion.copy(this.renderQuat);
    this.view.update(this.vehicle.wheels);

    if (this.photo.active) {
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

    this.timeOfDay.update(frameDt);
    this.timeOfDay.sunDirection(this.sunDir);
    this.rig.update(this.timeOfDay.state, this.sunDir, this.renderPos, this.chase.camera.position);

    // Ground-contact feedback. Both are driven off wheel contact points rather
    // than the body, so they mark where the truck actually meets the sand and
    // vanish the moment it doesn't.
    this.dustColor.copy(this.timeOfDay.state.sunColor).lerp(this.timeOfDay.state.horizon, 0.45);
    this.dust.setColor(this.dustColor);
    this.dust.emitFromWheels(
      this.vehicle.wheels,
      this.vehicle.telemetry.speed,
      frameDt,
      landingImpact,
    );
    this.dust.update(frameDt);
    this.contactShadow.update(this.vehicle.wheels, this.renderQuat, frameDt);
    // Rear wheels only: on a 4x4 the fronts run the same line, so laying all
    // four would just z-fight two ribbons against each other.
    this.tracks.update(this.vehicle.wheels, [2, 3], frameDt);

    this.audio.update(this.vehicle.telemetry, controls.throttle, frameDt);
    this.director.update(
      this.vehicle.telemetry,
      this.renderPos.x,
      this.renderPos.z,
      frameDt,
    );
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
    );
  };

  private handleHotkeys() {
    if (this.input.keyboard.consumePress('KeyT')) this.panel.toggle();
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
    document.body.classList.add('photo-mode');
    this.hud.element.hidden = true;
    this.input.touch.element.hidden = true;
  }

  private exitPhotoMode() {
    this.photo.exit();
    this.photoBar.hide();
    document.body.classList.remove('photo-mode');
    this.hud.element.hidden = false;
    if (matchMedia('(pointer: coarse)').matches) this.input.touch.element.hidden = false;
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
    const filename = `dune-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
    const file = new File([blob], filename, { type: 'image/png' });

    if (share && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'DUNE' });
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

  private applyQuality(tier: QualityTier) {
    this.tier = tier;
    const profile = PROFILES[tier];
    this.rig.applyQuality(profile);
    this.terrain.setQuality(profile);
    this.dust.setMaxParticles(profile.maxDust);
    this.scatter.setDensity(profile.scatterDensity);
    this.birds.setCount(profile.birds);
    this.wildlife.setCount(profile.gazelles);
    this.watchdog.reset();
    this.onResize();
  }

  private applyTouchScheme() {
    this.input.touch.setScheme(this.settings.touchScheme);
    this.input.touch.setHandedness(this.settings.handedness);
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
