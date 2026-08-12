import { FILTERS, PhotoMode, type PhotoFilter } from '../engine/PhotoMode';
import { haptics } from '../input/Haptics';

/**
 * Photo mode's controls. Appears only while photo mode is active, and stays out
 * of the frame the player is composing — the whole point is the picture.
 */
export class PhotoBar {
  readonly element: HTMLElement;
  private status: HTMLElement;

  constructor(
    private photo: PhotoMode,
    onSave: () => void,
    onShare: () => void,
    onExit: () => void,
  ) {
    this.element = document.createElement('div');
    this.element.className = 'photobar';
    this.element.hidden = true;

    const filters = document.createElement('div');
    filters.className = 'photobar-filters';
    for (const f of FILTERS) {
      const btn = document.createElement('button');
      btn.textContent = PhotoMode.label(f);
      btn.dataset.filter = f;
      btn.onclick = () => {
        haptics.tick();
        this.photo.filter = f;
        this.syncFilters(filters);
      };
      filters.appendChild(btn);
    }

    const vignette = document.createElement('input');
    vignette.type = 'range';
    vignette.min = '0';
    vignette.max = '1';
    vignette.step = '0.01';
    vignette.value = String(this.photo.vignette);
    vignette.className = 'photobar-vignette';
    vignette.oninput = () => { this.photo.vignette = Number(vignette.value); };

    const actions = document.createElement('div');
    actions.className = 'photobar-actions';

    const save = document.createElement('button');
    save.textContent = 'Save';
    // A shutter, not a tick: this is the one button here that produces a thing.
    save.onclick = () => {
      haptics.shutter();
      onSave();
    };

    const share = document.createElement('button');
    share.textContent = 'Share';
    // Only offered where the platform can actually do something with it.
    share.hidden = typeof navigator.share !== 'function';
    share.onclick = () => {
      haptics.shutter();
      onShare();
    };

    const exit = document.createElement('button');
    exit.textContent = 'Done';
    exit.className = 'photobar-exit';
    exit.onclick = () => {
      haptics.tick();
      onExit();
    };

    actions.append(save, share, exit);

    this.status = document.createElement('span');
    this.status.className = 'photobar-status';

    this.element.append(filters, vignette, actions, this.status);
    this.syncFilters(filters);
  }

  show() {
    this.element.hidden = false;
  }

  hide() {
    this.element.hidden = true;
    this.status.textContent = '';
  }

  say(message: string) {
    this.status.textContent = message;
    window.setTimeout(() => {
      if (this.status.textContent === message) this.status.textContent = '';
    }, 2600);
  }

  private syncFilters(container: HTMLElement) {
    for (const el of Array.from(container.children) as HTMLElement[]) {
      el.classList.toggle('is-active', el.dataset.filter === (this.photo.filter as PhotoFilter));
    }
  }
}
