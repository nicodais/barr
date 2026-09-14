import type { AudioEngine } from './AudioEngine';
const trackUrl = import.meta.env.BASE_URL + 'audio/desert-city.mp3';

/**
 * “Desert City” by Kevin MacLeod (CC BY 4.0), served locally and looped through
 * the adaptive score bus. Full attribution is available in the game's menu.
 * A media element avoids expanding the whole track into PCM on mobile.
 */
export class TrackScore {
  private el: HTMLAudioElement;
  private gain: GainNode;
  private started = false;

  constructor(private engine: AudioEngine) {
    this.el = new Audio(trackUrl);
    this.el.loop = true;
    // Wait for playback before downloading the full track.
    this.el.preload = 'metadata';

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

  /**
   * @param intensity 0..1 — the score leans in while you're actually driving.
   *
   * The two gains used to multiply: element 0.55-1.0 into a bus at 0.16-0.46,
   * so the track arrived somewhere between 0.09 and 0.46 while the world bus
   * ran at unity. That is 10-20dB under the vehicle, which is why the music was
   * barely audible. The element now runs flat and the bus alone carries the
   * swell, over a range that starts loud enough to hear when you're parked —
   * which is the whole point of a game about not being in a hurry.
   */
  update(_dt: number, intensity: number) {
    if (!this.engine.running) return;
    const t = this.engine.ctx.currentTime;
    this.gain.gain.setTargetAtTime(1, t, 1.6);
    this.engine.score.gain.setTargetAtTime(0.55 + intensity * 0.3, t, 1.6);
  }
}
