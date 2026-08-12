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
    // 'metadata' rather than 'auto', for safety rather than for a saving.
    //
    // Measured against the real build: nothing is fetched at page load or at
    // the map picker, because the graph is only built on a gesture and the
    // unlock listeners don't exist until Game has loaded. Once driving starts,
    // 2.8-4.2MB of the 11.79MB arrives in the first 30 seconds under *either*
    // setting — the spread across four runs is noise, not the flag. `preload`
    // stops mattering the moment `play()` is called, which happens immediately
    // after construction here.
    //
    // It stays 'metadata' so a future refactor that builds the element without
    // playing it doesn't quietly pull twelve megabytes. The real lever on this
    // asset is the asset: 11.79MB is a 16-minute track at ~98kbps, and only a
    // shorter loop or a lower bitrate moves it.
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
