import type { Poi } from '../data/pois';
import { POI_INFO } from '../data/poiInfo';

/**
 * The arrival card (§5): while the player is inside a POI's radius it fades in
 * with a real-world photo and a few lines on what the place means to the UAE —
 * culture then, significance now. Driving off fades it away. It never blocks,
 * never pauses, and takes no input; Ahmed stays the voice, this is the plaque.
 */
export class PoiCard {
  readonly element: HTMLElement;
  private photo: HTMLImageElement;
  private title: HTMLElement;
  private body: HTMLElement;
  private credit: HTMLElement;

  constructor() {
    this.element = document.createElement('aside');
    this.element.className = 'poi-card';

    this.photo = document.createElement('img');
    this.photo.alt = '';
    this.photo.decoding = 'async';
    this.photo.loading = 'lazy';
    // A missing or still-loading photo collapses to text-only, not a broken icon.
    this.photo.addEventListener('error', () => { this.photo.hidden = true; });
    this.element.appendChild(this.photo);

    this.title = document.createElement('h3');
    this.body = document.createElement('p');
    this.credit = document.createElement('small');
    this.element.append(this.title, this.body, this.credit);
  }

  show(poi: Poi) {
    const info = POI_INFO[poi.id];
    this.title.textContent = info.title;
    this.body.textContent = info.body;
    this.credit.textContent = info.credit ?? '';
    this.credit.hidden = !info.credit;
    if (info.photo) {
      this.photo.hidden = false;
      if (this.photo.getAttribute('src') !== info.photo) {
        this.photo.src = info.photo;
      }
    } else {
      this.photo.hidden = true;
    }
    this.element.classList.add('poi-card-show');
  }

  hide() {
    this.element.classList.remove('poi-card-show');
  }
}
