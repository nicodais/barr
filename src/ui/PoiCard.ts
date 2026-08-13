import type { Poi } from '../data/pois';
import { POI_INFO } from '../data/poiInfo';

/**
 * The arrival card (§5): while the player is inside a POI's radius it fades in
 * with a real-world photo and a few lines on what the place means to the UAE —
 * culture then, significance now. Driving off fades it away. It never blocks and
 * never pauses; Ahmed stays the voice, this is the plaque.
 *
 * It reads once and then gets out of the way. The full card is a photo plus a
 * paragraph, which on a phone is a third of the screen, and a POI radius is
 * 60-120m — so on the old always-expanded version the card sat over the view
 * for as long as it took to drive across the whole site, which is exactly when
 * the player wants to be looking at the thing it is describing. Now it shows in
 * full for long enough to read, then folds down to a title bar. Tapping the bar
 * brings it back for another read.
 */

/** Seconds the full card stays up before it folds away. */
const DWELL = 11;

export class PoiCard {
  readonly element: HTMLElement;
  private photo: HTMLImageElement;
  private title: HTMLElement;
  private body: HTMLElement;
  private credit: HTMLElement;
  private header: HTMLButtonElement;
  private details: HTMLElement;
  private inner: HTMLElement;
  private timer: number | null = null;

  constructor() {
    this.element = document.createElement('aside');
    this.element.className = 'poi-card';

    // A button, not a div: it is the one piece of this UI that takes a tap, and
    // making it a real control means keyboard and screen-reader users get the
    // expand for free rather than it being mouse-and-thumb only.
    this.header = document.createElement('button');
    this.header.type = 'button';
    this.header.className = 'poi-card-header';
    this.title = document.createElement('h3');
    const chevron = document.createElement('span');
    chevron.className = 'poi-card-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    this.header.append(this.title, chevron);
    this.header.addEventListener('click', () => this.toggle());

    this.details = document.createElement('div');
    this.details.className = 'poi-card-details';
    // Exactly one child, because the collapse is a 1fr -> 0fr grid-row
    // transition and `grid-template-rows` only sizes the rows it names — with
    // the photo, body and credit as three separate grid items, rows two and
    // three fell through to `auto` and the card folded to the same height it
    // started at.
    this.inner = document.createElement('div');
    this.inner.className = 'poi-card-inner';

    this.photo = document.createElement('img');
    this.photo.alt = '';
    this.photo.decoding = 'async';
    this.photo.loading = 'lazy';
    // Real photos live at /photos/{id}.jpg, dropped in by hand. Until one
    // exists, fall back to the in-palette .svg postcard; if that's missing too,
    // collapse to text-only rather than a broken icon.
    this.photo.addEventListener('error', () => {
      const src = this.photo.getAttribute('src') ?? '';
      if (src.endsWith('.jpg')) {
        this.photo.src = src.replace(/\.jpg$/, '.svg');
      } else {
        this.photo.hidden = true;
      }
    });

    this.body = document.createElement('p');
    this.credit = document.createElement('small');
    this.inner.append(this.photo, this.body, this.credit);
    this.details.append(this.inner);
    this.element.append(this.header, this.details);
  }

  show(poi: Poi) {
    // Per-POI overrides win over the shared per-kind card. See `Poi.info`.
    const info = { ...POI_INFO[poi.id], ...poi.info };
    this.title.textContent = info.title;
    this.body.textContent = info.body;
    // Credits are stored as full source URLs, which wrap to two lines of grey
    // slug on a phone. The host is the attribution — it names who the photo
    // came from, which is the whole obligation — and it fits on one line.
    this.credit.textContent = info.credit ? creditHost(info.credit) : '';
    this.credit.hidden = !info.credit;
    if (info.photo) {
      this.photo.hidden = false;
      if (this.photo.getAttribute('src') !== info.photo) {
        this.photo.src = info.photo;
      }
    } else {
      this.photo.hidden = true;
    }
    // `show` is called every frame the player is inside the radius, so it must
    // be idempotent — re-arming the dwell timer here would mean the card never
    // folds at all.
    if (!this.element.classList.contains('poi-card-show')) {
      this.element.classList.add('poi-card-show');
      this.expand();
    }
  }

  hide() {
    this.element.classList.remove('poi-card-show');
    this.clearTimer();
  }

  private toggle() {
    if (this.element.classList.contains('poi-card-folded')) this.expand();
    else this.fold();
  }

  private expand() {
    this.element.classList.remove('poi-card-folded');
    this.header.setAttribute('aria-expanded', 'true');
    this.clearTimer();
    this.timer = window.setTimeout(() => this.fold(), DWELL * 1000);
  }

  private fold() {
    this.element.classList.add('poi-card-folded');
    this.header.setAttribute('aria-expanded', 'false');
    this.clearTimer();
  }

  private clearTimer() {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

/** "https://www.example.com/a/b" -> "example.com". Non-URLs pass through. */
function creditHost(credit: string): string {
  try {
    return `Photo: ${new URL(credit).hostname.replace(/^www\./, '')}`;
  } catch {
    return credit;
  }
}
