import type { AudioEngine } from './AudioEngine';
import type { VehicleTelemetry } from '../vehicle/Vehicle';
import type { BodyId } from '../vehicle/vehicleConfig';
import { ENGINE_VOICES, type EngineVoice } from './engineVoices';

/**
 * Diegetic vehicle audio (§6): engine note tied to RPM, tyre foley whose tone
 * follows sand density, and wind that rises with speed.
 *
 * The engine is a stack of harmonics rather than a sample loop, which means it
 * pitches continuously with no crossfade seams and costs nothing to ship. There
 * is no gearbox in the physics, so RPM is derived from speed through a fake set
 * of ratios — the shift points are audible, and that's the point: they're what
 * makes acceleration read as effort rather than a siren.
 *
 * Everything about the note's *character* comes from the current body's
 * `EngineVoice` (engineVoices.ts). This class owns how the synth behaves; that
 * table owns what each vehicle sounds like.
 */
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
  private voice: EngineVoice = ENGINE_VOICES.wagon;

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

  /**
   * Swap the engine's character. Called on every body change, including from
   * the pre-drive picker, so the truck you chose is the one you hear.
   */
  setBody(body: BodyId) {
    this.voice = ENGINE_VOICES[body] ?? ENGINE_VOICES.wagon;
  }

  update(tel: VehicleTelemetry, throttle: number, dt: number) {
    const ctx = this.engine.ctx;
    const t = ctx.currentTime;
    const speed = Math.abs(tel.forwardSpeed);
    const v = this.voice;

    // Pick a gear from speed, then derive RPM within it.
    const gearSpan = v.gearTop / v.gears;
    const gearIndex = Math.min(v.gears - 1, Math.floor(speed / gearSpan));
    const withinGear = (speed - gearIndex * gearSpan) / gearSpan;
    let targetRpm = IDLE_RPM + withinGear * 0.85 + throttle * 0.12;
    // Airborne or wheelspinning on soft sand, revs flare — no load on the engine.
    if (tel.airborne) targetRpm = Math.max(targetRpm, IDLE_RPM + throttle * 0.8);
    targetRpm = Math.min(1.15, targetRpm);

    this.rpm += (targetRpm - this.rpm) * Math.min(1, dt * 7);

    const base = v.idleHz + this.rpm * v.spanHz;
    this.oscSub.frequency.setTargetAtTime(base * 0.5, t, 0.04);
    this.oscA.frequency.setTargetAtTime(base, t, 0.04);
    this.oscB.frequency.setTargetAtTime(base * 2.02, t, 0.04);

    // Louder and brighter under load; a heavy 4x4 should sound like it's working.
    const load = 0.28 + throttle * 0.5 + Math.min(0.25, speed / 60);
    this.engineGain.gain.setTargetAtTime(load * v.level, t, 0.08);
    this.engineFilter.frequency.setTargetAtTime(
      v.cutoffHz + this.rpm * v.cutoffSpan + throttle * v.cutoffSpan * 0.4, t, 0.08,
    );
    // Throttle adds edge on top of each voice's own mix rather than replacing
    // it, so a diesel under load gets clattery and a thumper gets shrill.
    this.gainA.gain.setTargetAtTime(v.saw * (1 + throttle * 0.8), t, 0.1);
    this.gainB.gain.setTargetAtTime(v.square * (1 + throttle * 2), t, 0.1);
    this.gainSub.gain.setTargetAtTime(v.sub, t, 0.1);

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

  /**
   * Airing down (§2, backlog 10). A valve hiss for as long as the change takes.
   *
   * The mechanic already runs over 1.5s per step and already buzzes the phone,
   * and in between it was silent — which made a deliberate act read like a menu
   * toggle. The filter sweeps down across the hiss because that is what a tyre
   * actually does: the escaping air slows and deepens as the pressure drops.
   */
  airDown(duration: number) {
    const ctx = this.engine.ctx;
    const t = ctx.currentTime;
    const end = t + duration;

    const src = this.engine.createNoiseSource();
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.4;
    filter.frequency.setValueAtTime(2600, t);
    filter.frequency.exponentialRampToValueAtTime(1500, end);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    // Fast in, because a valve opens fast; slow out, because you let go of it.
    gain.gain.exponentialRampToValueAtTime(0.14, t + 0.06);
    gain.gain.setValueAtTime(0.14, end - 0.18);
    gain.gain.exponentialRampToValueAtTime(0.0001, end + 0.1);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.engine.world);
    src.start(t);
    src.stop(end + 0.15);
  }

  /**
   * Airing back up: a small 12V compressor, which is a chugging pump rather
   * than a hiss, finished by the clunk of the chuck coming off.
   */
  airUp(duration: number) {
    const ctx = this.engine.ctx;
    const t = ctx.currentTime;
    const end = t + duration;

    const src = this.engine.createNoiseSource();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 520;
    filter.Q.value = 3;

    const body = ctx.createGain();
    body.gain.setValueAtTime(0.0001, t);
    body.gain.exponentialRampToValueAtTime(0.1, t + 0.12);
    body.gain.setValueAtTime(0.1, end - 0.1);
    body.gain.exponentialRampToValueAtTime(0.0001, end);

    // The chug. A square LFO on the gain is what turns flat noise into a pump
    // with pistons in it; without it this is just brown noise for two seconds.
    const chug = ctx.createGain();
    chug.gain.value = 0.55;
    const lfo = ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 7.5;
    const depth = ctx.createGain();
    depth.gain.value = 0.42;
    lfo.connect(depth);
    depth.connect(chug.gain);
    lfo.start(t);
    lfo.stop(end + 0.05);

    src.connect(filter);
    filter.connect(chug);
    chug.connect(body);
    body.connect(this.engine.world);
    src.start(t);
    src.stop(end + 0.05);

    // The chuck coming off, once the pump stops.
    const clunk = this.engine.createNoiseSource();
    const clunkFilter = ctx.createBiquadFilter();
    clunkFilter.type = 'lowpass';
    clunkFilter.frequency.setValueAtTime(900, end);
    clunkFilter.frequency.exponentialRampToValueAtTime(180, end + 0.09);
    const clunkGain = ctx.createGain();
    clunkGain.gain.setValueAtTime(0.16, end);
    clunkGain.gain.exponentialRampToValueAtTime(0.0001, end + 0.12);
    clunk.connect(clunkFilter);
    clunkFilter.connect(clunkGain);
    clunkGain.connect(this.engine.world);
    clunk.start(end);
    clunk.stop(end + 0.15);
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
