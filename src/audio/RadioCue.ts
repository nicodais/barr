import type { AudioEngine } from './AudioEngine';

/**
 * The "kssshhht" (§6). Ahmed is never voiced — a squelch when he keys up and a
 * shorter one when he signs off is the entire audio side of the character, and
 * the lines themselves scroll as text.
 *
 * Built from band-limited noise with a resonant sweep, plus a click transient,
 * which is what actually sells a carrier opening rather than just "static".
 */
export class RadioCue {
  constructor(private engine: AudioEngine) {}

  /**
   * Carrier opens. A squelch is a transient, not a sound effect — it should be
   * over almost before you register it, leaving the line of text to do the work.
   */
  keyUp() {
    this.burst(0.11, 1800, 2900, 0.8);
    this.click(0.2);
  }

  /** Carrier closes — shorter still and falling, so sign-off reads as an ending. */
  signOff() {
    this.burst(0.075, 2600, 1400, 0.58);
    this.click(0.14);
  }

  private burst(duration: number, fromHz: number, toHz: number, level: number) {
    const ctx = this.engine.ctx;
    const t = ctx.currentTime;

    const src = this.engine.createNoiseSource();

    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.setValueAtTime(fromHz, t);
    band.frequency.exponentialRampToValueAtTime(Math.max(80, toHz), t + duration);
    // Narrow enough to sound like a receiver rather than a hiss.
    band.Q.value = 2.4;

    // Roll the extremes off so it sits in a comms band, not the whole spectrum.
    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 420;

    const gain = ctx.createGain();
    // Sharp attack straight into decay, with no sustain in between. The held
    // section is what made this read as a burst of static rather than a click.
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(level, t + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);

    src.connect(band);
    band.connect(highpass);
    highpass.connect(gain);
    gain.connect(this.engine.radio);

    src.start(t);
    src.stop(t + duration + 0.05);
  }

  private click(level: number) {
    const ctx = this.engine.ctx;
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(70, t + 0.025);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);

    // Through the same comms band as the noise. Unfiltered, the square wave
    // arrived as a clean electronic blip sitting on top of the mix instead of
    // as part of the squelch — it was the loudest thing in the cue.
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 1300;
    band.Q.value = 0.9;

    osc.connect(gain);
    gain.connect(band);
    band.connect(this.engine.radio);
    osc.start(t);
    osc.stop(t + 0.04);
  }
}
