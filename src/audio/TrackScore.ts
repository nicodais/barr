import type { AudioEngine } from './AudioEngine';
import trackUrl from './Barr Background Music.mp3';

/**
 * The authored background score: the Barr track, looped through the score bus
 * in place of the synthesized oud bed (kept in AmbientScore, unwired). The
 * adaptive mix survives the swap — the bus still swells with driving intensity
 * and ducks under Ahmed's radio calls (§6).
 *
 * The file is fetched and decoded lazily after the audio unlock gesture, so the
 * ~12MB asset never blocks first paint; until it arrives the desert just has
 * wind, which is a fine state for it to be in.
 */
export class TrackScore {
  private gain: GainNode;
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private started = false;

  constructor(private engine: AudioEngine) {
    this.gain = engine.ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(engine.score);
    void this.load();
  }

  private async load() {
    try {
      const res = await fetch(trackUrl);
      const data = await res.arrayBuffer();
      this.buffer = await this.engine.ctx.decodeAudioData(data);
      if (this.started) this.play();
    } catch (err) {
      // Music is a nice-to-have; a failed fetch must not take the wind with it.
      console.warn('[dune] score track unavailable', err);
    }
  }

  private play() {
    if (!this.buffer || this.source) return;
    const src = this.engine.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.loop = true;
    src.connect(this.gain);
    src.start();
    this.source = src;
  }

  start() {
    this.started = true;
    if (this.buffer) this.play();
  }

  /** @param intensity 0..1 — the score leans in while you're actually driving. */
  update(_dt: number, intensity: number) {
    if (!this.engine.running) return;
    const t = this.engine.ctx.currentTime;
    this.gain.gain.setTargetAtTime(0.55 + intensity * 0.45, t, 1.6);
    this.engine.score.gain.setTargetAtTime(0.16 + intensity * 0.3, t, 1.6);
  }
}
