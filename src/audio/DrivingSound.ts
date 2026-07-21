import type { AudioEngine } from './AudioEngine';
import type { VehicleTelemetry } from '../vehicle/Vehicle';

/**
 * Diegetic vehicle audio (§6): engine note tied to RPM, tyre foley whose tone
 * follows sand density, and wind that rises with speed.
 *
 * The engine is a stack of harmonics rather than a sample loop, which means it
 * pitches continuously with no crossfade seams and costs nothing to ship. There
 * is no gearbox in the physics, so RPM is derived from speed through a fake set
 * of ratios — the shift points are audible, and that's the point: they're what
 * makes acceleration read as effort rather than a siren.
 */
const GEAR_RATIOS = [3.4, 2.0, 1.35, 1.0, 0.78];
const IDLE_RPM = 0.14;

export class DrivingSound {
  private engineGain: GainNode;
  private engineFilter: BiquadFilterNode;
  private oscA: OscillatorNode;
  private oscB: OscillatorNode;
  private oscSub: OscillatorNode;
  private gainA: GainNode;
  private gainB: GainNode;
  private gainSub: GainNode;

  private tyreSource: AudioBufferSourceNode;
  private tyreFilter: BiquadFilterNode;
  private tyreGain: GainNode;

  private windSource: AudioBufferSourceNode;
  private windFilter: BiquadFilterNode;
  private windGain: GainNode;

  /** Smoothed so gear changes glide instead of stepping. */
  private rpm = IDLE_RPM;

  constructor(private engine: AudioEngine) {
    const ctx = engine.ctx;

    // --- engine ---
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 500;
    this.engineFilter.Q.value = 0.7;
    this.engineGain.connect(this.engineFilter);
    this.engineFilter.connect(engine.world);

    const mkOsc = (type: OscillatorType, gain: number) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      const g = ctx.createGain();
      g.gain.value = gain;
      osc.connect(g);
      g.connect(this.engineGain);
      osc.start();
      return { osc, g };
    };
    // A big lazy diesel-ish note: strong low fundamental, softer upper harmonic.
    const sub = mkOsc('sine', 0.55);
    const a = mkOsc('sawtooth', 0.3);
    const b = mkOsc('square', 0.12);
    this.oscSub = sub.osc; this.gainSub = sub.g;
    this.oscA = a.osc; this.gainA = a.g;
    this.oscB = b.osc; this.gainB = b.g;

    // --- tyres on sand ---
    this.tyreSource = engine.createNoiseSource();
    this.tyreFilter = ctx.createBiquadFilter();
    this.tyreFilter.type = 'bandpass';
    this.tyreFilter.frequency.value = 900;
    this.tyreFilter.Q.value = 0.9;
    this.tyreGain = ctx.createGain();
    this.tyreGain.gain.value = 0;
    this.tyreSource.connect(this.tyreFilter);
    this.tyreFilter.connect(this.tyreGain);
    this.tyreGain.connect(engine.world);
    this.tyreSource.start();

    // --- wind ---
    this.windSource = engine.createNoiseSource();
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 420;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.02;
    this.windSource.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(engine.world);
    this.windSource.start();
  }

  update(tel: VehicleTelemetry, throttle: number, dt: number) {
    const ctx = this.engine.ctx;
    const t = ctx.currentTime;
    const speed = Math.abs(tel.forwardSpeed);

    // Pick a gear from speed, then derive RPM within it.
    const gearSpan = 33 / GEAR_RATIOS.length;
    const gearIndex = Math.min(GEAR_RATIOS.length - 1, Math.floor(speed / gearSpan));
    const withinGear = (speed - gearIndex * gearSpan) / gearSpan;
    let targetRpm = IDLE_RPM + withinGear * 0.85 + throttle * 0.12;
    // Airborne or wheelspinning on soft sand, revs flare — no load on the engine.
    if (tel.airborne) targetRpm = Math.max(targetRpm, IDLE_RPM + throttle * 0.8);
    targetRpm = Math.min(1.15, targetRpm);

    this.rpm += (targetRpm - this.rpm) * Math.min(1, dt * 7);

    const base = 38 + this.rpm * 118;
    this.oscSub.frequency.setTargetAtTime(base * 0.5, t, 0.04);
    this.oscA.frequency.setTargetAtTime(base, t, 0.04);
    this.oscB.frequency.setTargetAtTime(base * 2.02, t, 0.04);

    // Louder and brighter under load; a heavy 4x4 should sound like it's working.
    const load = 0.28 + throttle * 0.5 + Math.min(0.25, speed / 60);
    this.engineGain.gain.setTargetAtTime(load * 0.22, t, 0.08);
    this.engineFilter.frequency.setTargetAtTime(380 + this.rpm * 1500 + throttle * 600, t, 0.08);
    this.gainA.gain.setTargetAtTime(0.22 + throttle * 0.18, t, 0.1);
    this.gainB.gain.setTargetAtTime(0.06 + throttle * 0.12, t, 0.1);
    this.gainSub.gain.setTargetAtTime(0.5, t, 0.1);

    // --- tyres: soft sand hisses low and broad, hardpack is grittier and higher
    const contact = tel.wheelsOnGround / 4;
    const soft = tel.surfaceSoftness;
    const tyreLevel = contact * Math.min(1, speed / 16) * (0.1 + soft * 0.16);
    this.tyreGain.gain.setTargetAtTime(tyreLevel, t, 0.09);
    this.tyreFilter.frequency.setTargetAtTime(1500 - soft * 850 + speed * 14, t, 0.12);
    this.tyreFilter.Q.setTargetAtTime(0.6 + (1 - soft) * 1.4, t, 0.2);

    // --- wind: rises with speed, and a touch more when airborne
    const windLevel = 0.015 + Math.min(0.14, (speed / 33) ** 2 * 0.14) + (tel.airborne ? 0.03 : 0);
    this.windGain.gain.setTargetAtTime(windLevel, t, 0.25);
    this.windFilter.frequency.setTargetAtTime(320 + speed * 26, t, 0.3);
  }

  /** A dull thud through the suspension when the truck lands. */
  landing(impact: number) {
    if (impact <= 0.05) return;
    const ctx = this.engine.ctx;
    const t = ctx.currentTime;

    const src = this.engine.createNoiseSource();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(300 + impact * 300, t);
    filter.frequency.exponentialRampToValueAtTime(70, t + 0.3);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(Math.min(0.5, impact * 0.5), t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.engine.world);
    src.start(t);
    src.stop(t + 0.4);
  }
}
