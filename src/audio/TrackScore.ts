import type { AudioEngine } from './AudioEngine';
import trackUrl from './Barr Background Music.mp3';

/**
 * The authored background score: the Barr track, looped through the score bus
 * in place of the synthesized oud bed (kept in AmbientScore, unwired). The
 * adaptive mix survives the swap — the bus still swells with driving intensity
 * and ducks under Ahmed's radio calls (§6).
 *
 * Played through an <audio> element rather than decodeAudioData on purpose:
 * decoding a 16-minute track expands to ~340MB of PCM, which mobile browsers
 * will refuse or be killed over. A media element streams it at a few MB of
 * memory, loops natively, and still routes through the Web Audio graph.
 */
export class TrackScore {
  private el: HTMLAudioElement;
  private gain: GainNode;
  private started = false;

  constructor(private engine: AudioEngine) {
    this.el = new Audio(trackUrl);
    this.el.loop = true;
    this.el.preload = 'auto';

    this.gain = engine.ctx.createGain();
    this.gain.gain.value = 0;
    engine.ctx.createMediaElementSource(this.el).connect(this.gain);
    this.gain.connect(engine.score);
  }

  start() {
    if (this.started) return;
    this.started = true;
    // play() can reject before a gesture has blessed the element; the unlock
    // path retries start() on later gestures, so a rejection here is not final.
    this.el.play().catch(() => { this.started = false; });
  }

  /** @param intensity 0..1 — the score leans in while you're actually driving. */
  update(_dt: number, intensity: number) {
    if (!this.engine.running) return;
    const t = this.engine.ctx.currentTime;
    this.gain.gain.setTargetAtTime(0.55 + intensity * 0.45, t, 1.6);
    this.engine.score.gain.setTargetAtTime(0.16 + intensity * 0.3, t, 1.6);
  }
}
