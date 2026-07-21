import { AudioEngine } from './AudioEngine';
import { TrackScore } from './TrackScore';
import { DrivingSound } from './DrivingSound';
import { RadioCue } from './RadioCue';
import type { VehicleTelemetry } from '../vehicle/Vehicle';

/**
 * One place for the game to talk to audio, and the owner of the adaptive mix
 * (§6): the ambient bed is always there, the oud comes up while you're actually
 * driving, and both duck under an incoming call.
 *
 * Construction is deferred until a real gesture, because every browser refuses
 * to start an AudioContext without one and a suspended context set up at load
 * just produces silence with no error.
 */
export class GameAudio {
  private engine: AudioEngine | null = null;
  private driving: DrivingSound | null = null;
  private score: TrackScore | null = null;
  private cue: RadioCue | null = null;
  private muted = false;
  private volume = 0.9;
  /** Smoothed "how much is happening", which drives the score's presence. */
  private intensity = 0;

  get ready(): boolean {
    return this.engine?.running ?? false;
  }

  /** Safe to call repeatedly; only the first gesture does any work. */
  async unlock(): Promise<void> {
    if (this.engine) {
      await this.engine.resume();
      return;
    }
    try {
      const engine = new AudioEngine();
      const ok = await engine.resume();
      if (!ok) return;
      this.engine = engine;
      this.driving = new DrivingSound(engine);
      this.score = new TrackScore(engine);
      this.cue = new RadioCue(engine);
      this.score.start();
      engine.setMasterVolume(this.muted ? 0 : this.volume);
    } catch (err) {
      // Audio is a nice-to-have; a browser refusing it must not stop the drive.
      console.warn('[dune] audio unavailable', err);
    }
  }

  update(tel: VehicleTelemetry, throttle: number, dt: number) {
    if (!this.engine?.running) return;

    // Score presence tracks speed and airtime rather than raw throttle, so it
    // swells on a fast run across a pan and recedes when you stop to look.
    const target = Math.min(1, tel.speedKph / 70) * 0.8 + (tel.airborne ? 0.2 : 0);
    this.intensity += (target - this.intensity) * Math.min(1, dt * 0.6);

    this.driving?.update(tel, throttle, dt);
    this.score?.update(dt, this.intensity);
    if (tel.landingImpact > 0.05) this.driving?.landing(tel.landingImpact);
  }

  radioKeyUp() {
    this.cue?.keyUp();
    // "Slightly" (§6). There is no voice to make room for — the duck only has to
    // open a little space around the cue and under the first beat of the line,
    // so it stays shallow and lets go quickly.
    this.engine?.duck(0.3, 0.07, 0.7, 0.9);
  }

  radioSignOff() {
    this.cue?.signOff();
    this.engine?.duck(0.2, 0.06, 0.25, 0.6);
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    this.engine?.setMasterVolume(muted ? 0 : this.volume);
  }

  setVolume(v: number) {
    this.volume = v;
    if (!this.muted) this.engine?.setMasterVolume(v);
  }
}
