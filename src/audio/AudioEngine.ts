/**
 * The Web Audio graph everything else plugs into (§6).
 *
 * Four buses so the adaptive mix has something to actually move: world (engine,
 * tyres, wind), score (drone and oud), radio (Ahmed's static), all under a
 * master. Ducking dips world and score together so a call-in cuts through
 * without the engine dropping out entirely.
 *
 * Nothing here loads a file. Every sound in the game is synthesised, which keeps
 * the payload at zero bytes and sidesteps the whole streaming-audio problem on
 * mobile (§8).
 */
export class AudioEngine {
  readonly ctx: AudioContext;
  readonly master: GainNode;
  readonly world: GainNode;
  readonly score: GainNode;
  readonly radio: GainNode;
  readonly reverb: ConvolverNode;
  readonly reverbSend: GainNode;

  private limiter: DynamicsCompressorNode;
  private duckGain: GainNode;
  private noiseBuffer: AudioBuffer;
  private started = false;

  constructor() {
    const Ctor: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctor();

    // A limiter on the way out. Everything here is synthesised, several voices
    // can stack, and one of them is a feedback loop — a hard ceiling means a
    // tuning mistake is a dull moment rather than a painful one in someone's
    // headphones.
    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -6;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.004;
    this.limiter.release.value = 0.18;
    this.limiter.connect(this.ctx.destination);

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.limiter);

    // Ducked bus sits between the mix and the master, so the radio bypasses it.
    this.duckGain = this.ctx.createGain();
    this.duckGain.gain.value = 1;
    this.duckGain.connect(this.master);

    this.world = this.ctx.createGain();
    this.world.gain.value = 1;
    this.world.connect(this.duckGain);

    this.score = this.ctx.createGain();
    this.score.gain.value = 0;
    this.score.connect(this.duckGain);

    this.radio = this.ctx.createGain();
    // The squelch is a punctuation mark, not an event. It sits under the mix
    // rather than on top of it.
    this.radio.gain.value = 0.42;
    this.radio.connect(this.master);

    this.noiseBuffer = createNoiseBuffer(this.ctx, 2);

    this.reverb = this.ctx.createConvolver();
    this.reverb.buffer = createImpulseResponse(this.ctx, 2.6, 2.4);
    this.reverbSend = this.ctx.createGain();
    this.reverbSend.gain.value = 0.32;
    this.reverbSend.connect(this.reverb);
    this.reverb.connect(this.duckGain);
  }

  /**
   * Browsers refuse to start audio without a gesture, so this is called from the
   * first real input rather than at load.
   */
  async resume(): Promise<boolean> {
    if (this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch {
        return false;
      }
    }
    this.started = this.ctx.state === 'running';
    return this.started;
  }

  get running(): boolean {
    return this.started && this.ctx.state === 'running';
  }

  get now(): number {
    return this.ctx.currentTime;
  }

  /** A looping white-noise source. Callers own the returned node's lifetime. */
  createNoiseSource(): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    return src;
  }

  /** Dips the world and score buses under an incoming call (§6). */
  duck(amount: number, attack = 0.18, hold = 0.4, release = 0.9) {
    const g = this.duckGain.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(1 - amount, t + attack);
    g.setValueAtTime(1 - amount, t + attack + hold);
    g.linearRampToValueAtTime(1, t + attack + hold + release);
  }

  setMasterVolume(v: number) {
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }
}

function createNoiseBuffer(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/**
 * Synthesised impulse response: decaying noise. Not a real space, but it gives
 * the oud somewhere to sit other than flat against the listener's ear.
 */
function createImpulseResponse(ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * seconds);
  const buffer = ctx.createBuffer(2, length, rate);
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < length; i++) {
      const t = i / length;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
    }
  }
  return buffer;
}
