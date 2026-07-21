import type { AudioEngine } from './AudioEngine';

/**
 * The oud-led ambient bed (§6): a slow drone with plucked phrases over it,
 * generated rather than looped so it never repeats audibly on a 45-minute drive.
 *
 * Notes sit in maqam Hijaz on D (D Eb F# G A Bb C), whose augmented second
 * between Eb and F# is the interval that places the whole thing geographically.
 */
const HIJAZ_D = [146.83, 155.56, 185.0, 196.0, 220.0, 233.08, 261.63, 293.66];

export class AmbientScore {
  private droneGain: GainNode;
  private droneOscs: OscillatorNode[] = [];
  private nextNoteIn = 2.5;
  private phraseRemaining = 0;
  private lastDegree = 0;
  private started = false;

  constructor(private engine: AudioEngine) {
    const ctx = engine.ctx;

    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0;
    this.droneGain.connect(engine.score);
    this.droneGain.connect(engine.reverbSend);

    // Root, octave and a fifth, each slightly detuned so the drone breathes
    // instead of sitting as a dead sine.
    for (const [freq, level, detune] of [
      [73.42, 0.5, 0],
      [146.83, 0.26, 4],
      [220.0, 0.14, -6],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      osc.detune.value = detune;

      const g = ctx.createGain();
      g.gain.value = level;

      // Very slow amplitude drift, so the pad moves without ever being a effect.
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.03 + Math.random() * 0.04;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = level * 0.35;
      lfo.connect(lfoGain);
      lfoGain.connect(g.gain);
      lfo.start();

      osc.connect(g);
      g.connect(this.droneGain);
      osc.start();
      this.droneOscs.push(osc, lfo);
    }
  }

  start() {
    this.started = true;
  }

  /**
   * @param intensity 0..1 — how present the score should be. Driving brings the
   *                  oud in, sitting still lets it recede to almost nothing.
   */
  update(dt: number, intensity: number) {
    if (!this.started || !this.engine.running) return;
    const ctx = this.engine.ctx;
    const t = ctx.currentTime;

    this.engine.score.gain.setTargetAtTime(0.16 + intensity * 0.3, t, 1.6);
    this.droneGain.gain.setTargetAtTime(0.06 + intensity * 0.05, t, 2.2);

    this.nextNoteIn -= dt;
    if (this.nextNoteIn > 0) return;

    // Phrases of 1–4 notes, then a long rest. The silences matter more than the
    // notes here; this is meant to be a bed, not a melody you follow.
    if (this.phraseRemaining <= 0) {
      this.phraseRemaining = 1 + Math.floor(Math.random() * 4);
      this.lastDegree = Math.floor(Math.random() * HIJAZ_D.length);
    }

    // Step by a small interval so phrases wander rather than leap.
    const step = [-2, -1, -1, 0, 1, 1, 2][Math.floor(Math.random() * 7)];
    this.lastDegree = Math.max(0, Math.min(HIJAZ_D.length - 1, this.lastDegree + step));
    this.pluck(HIJAZ_D[this.lastDegree], 0.35 + Math.random() * 0.4);

    this.phraseRemaining--;
    this.nextNoteIn =
      this.phraseRemaining > 0
        ? 0.42 + Math.random() * 0.7
        : 3.5 + Math.random() * 7 - intensity * 1.5;
  }

  /**
   * A plucked note as a decaying harmonic stack plus a pick transient.
   *
   * The obvious way to synthesise a string is Karplus-Strong — a delay line fed
   * back through a damping filter — and it sounds better. It is not used here:
   * inside a Web Audio feedback cycle it diverged in practice even with loop
   * gain provably below unity, taking the whole mix to ~1e27 within seconds.
   * Additive synthesis has no feedback path, so it cannot run away no matter how
   * it's tuned. Upper partials decaying faster than the fundamental is what
   * actually makes a note read as *plucked* rather than bowed, and that survives
   * the change intact.
   */
  private pluck(freq: number, velocity: number) {
    const ctx = this.engine.ctx;
    const t = ctx.currentTime;

    const out = ctx.createGain();
    out.gain.value = 0.3;
    out.connect(this.engine.score);
    out.connect(this.engine.reverbSend);

    // Slightly stretched partials: real strings are not perfectly harmonic, and
    // the small detune is most of what stops this sounding like an organ.
    const partials: Array<[number, number, number]> = [
      [1.0, 1.0, 2.8],
      [2.005, 0.46, 1.7],
      [3.02, 0.24, 1.0],
      [4.04, 0.12, 0.62],
      [5.45, 0.06, 0.4],
    ];

    let longest = 0;
    for (const [mult, level, decay] of partials) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      // A touch sharp on the attack, settling to pitch — how a plucked string
      // behaves as the initial tension releases.
      osc.frequency.setValueAtTime(freq * mult * 1.006, t);
      osc.frequency.exponentialRampToValueAtTime(freq * mult, t + 0.09);

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(level * velocity, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay);

      osc.connect(g);
      g.connect(out);
      osc.start(t);
      osc.stop(t + decay + 0.1);
      longest = Math.max(longest, decay);
    }

    // The pick itself: a short filtered noise transient.
    const noise = this.engine.createNoiseSource();
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = freq * 4.5;
    band.Q.value = 1.1;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(velocity * 0.35, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    noise.connect(band);
    band.connect(noiseGain);
    noiseGain.connect(out);
    noise.start(t);
    noise.stop(t + 0.14);

    // Oscillators free themselves once stopped; just drop the mixer node.
    window.setTimeout(() => out.disconnect(), (longest + 0.4) * 1000);
  }
}
