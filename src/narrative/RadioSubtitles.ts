/**
 * Ahmed's side of the radio, as text at the bottom of the screen (§5, §6).
 *
 * No voice acting anywhere: a static cue plays, the line types itself in, holds,
 * then fades. It is deliberately non-blocking — it never pauses the game, never
 * waits for input, and never darkens or letterboxes anything. You can drive
 * straight through a call-in and miss it, and that's fine.
 */
const TYPE_SPEED = 42; // characters per second
const HOLD_PER_CHAR = 0.055;
const MIN_HOLD = 2.2;
const FADE = 0.7;

type Phase = 'idle' | 'typing' | 'holding' | 'fading';

/**
 * Someone who has asked for less motion has asked not to watch text crawl
 * across the screen either. The line still holds and fades on the same
 * schedule — only the typing goes.
 */
function typingWanted(): boolean {
  return !matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export class RadioSubtitles {
  readonly element: HTMLElement;
  private nameEl: HTMLElement;
  private lineEl: HTMLElement;
  /** The whole line at once, for a screen reader. The visible element types
   *  itself in one character at a time, which announced as a stutter. */
  private liveEl: HTMLElement;

  private phase: Phase = 'idle';
  private full = '';
  private shown = 0;
  private timer = 0;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'radio';
    this.element.hidden = true;

    this.nameEl = document.createElement('span');
    this.nameEl.className = 'radio-name';
    this.nameEl.textContent = 'AHMED';

    this.lineEl = document.createElement('span');
    this.lineEl.className = 'radio-line';
    this.lineEl.setAttribute('aria-hidden', 'true');

    this.liveEl = document.createElement('span');
    this.liveEl.className = 'sr-only';
    this.liveEl.setAttribute('role', 'status');
    this.liveEl.setAttribute('aria-live', 'polite');

    this.element.append(this.nameEl, this.lineEl, this.liveEl);
  }

  get busy(): boolean {
    return this.phase !== 'idle';
  }

  show(line: string) {
    this.full = line;
    this.shown = 0;
    this.element.hidden = false;
    this.element.classList.remove('radio-out');
    if (typingWanted()) {
      this.timer = 0;
      this.phase = 'typing';
      this.lineEl.textContent = '';
    } else {
      // Straight to the hold, with the same dwell the typed version would have
      // ended up with — the line is on screen for as long either way.
      this.lineEl.textContent = line;
      this.phase = 'holding';
      this.timer = Math.max(MIN_HOLD, line.length * HOLD_PER_CHAR);
    }
    // Announced once, in full, at the moment he keys up.
    this.liveEl.textContent = `Ahmed: ${line}`;
  }

  update(dt: number) {
    switch (this.phase) {
      case 'typing': {
        this.shown += TYPE_SPEED * dt;
        const n = Math.min(this.full.length, Math.floor(this.shown));
        this.lineEl.textContent = this.full.slice(0, n);
        if (n >= this.full.length) {
          this.phase = 'holding';
          this.timer = Math.max(MIN_HOLD, this.full.length * HOLD_PER_CHAR);
        }
        break;
      }
      case 'holding': {
        this.timer -= dt;
        if (this.timer <= 0) {
          this.phase = 'fading';
          this.timer = FADE;
          this.element.classList.add('radio-out');
        }
        break;
      }
      case 'fading': {
        this.timer -= dt;
        if (this.timer <= 0) {
          this.phase = 'idle';
          this.element.hidden = true;
          this.element.classList.remove('radio-out');
        }
        break;
      }
      case 'idle':
        break;
    }
  }
}
