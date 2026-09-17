import { REGIONS, REGION_ORDER, type RegionId } from '../terrain/regions';
import { GAME_NAME, GAME_NAME_AR } from '../brand';
import { haptics } from '../input/Haptics';

/**
 * Where you're driving today.
 *
 * Runs ahead of the car picker, because the region decides what the height
 * field *is* — picking it before the truck is built means one clean teardown at
 * boot rather than a rebuild a second later, and it reads in the right order
 * too: you choose where you're going, then what you're taking.
 *
 * It also runs ahead of the *engine*. Nothing in this file's dependency graph
 * touches three or Rapier — it is DOM and CSS and a table of region names — so
 * it can be on screen and answering taps while the 2MB physics chunk is still
 * arriving. That makes the first interactive moment a choice rather than a
 * progress message, and buys the download however long the player spends
 * reading two cards. Keep it that way: an import of anything from /engine,
 * /vehicle or /terrain beyond the region table silently puts the whole engine
 * back in front of the first paint.
 *
 * Same rules as CarSelect: nothing here blocks, there's always a choice already
 * made, and hitting Enter straight through is a complete interaction. It is
 * also reachable later from the menu, so this is a starting point rather than
 * the one chance to get it right.
 */
export class MapSelect {
  readonly element: HTMLElement;
  private cards: HTMLElement;
  private resolve: ((id: RegionId) => void) | null = null;
  private picked: RegionId;
  private go!: HTMLButtonElement;

  constructor(initial: RegionId) {
    this.picked = initial;

    this.element = document.createElement('div');
    this.element.className = 'carselect mapselect';
    this.element.hidden = true;

    const panel = document.createElement('div');
    panel.className = 'carselect-panel';

    const title = document.createElement('h1');
    title.className = 'carselect-title';
    title.textContent = GAME_NAME;

    const eyebrow = document.createElement('p');
    eyebrow.className = 'mapselect-eyebrow';
    eyebrow.textContent = GAME_NAME_AR + '  /  UNITED ARAB EMIRATES';
    const intro = document.createElement('p');
    intro.className = 'mapselect-intro';
    intro.textContent = 'Follow the wind.';

    const sub = document.createElement('p');
    sub.className = 'carselect-sub';
    sub.textContent = 'Four landscapes. An open horizon. Take your time.';

    this.cards = document.createElement('div');
    this.cards.className = 'mapselect-cards';
    for (const id of REGION_ORDER) {
      const region = REGIONS[id];
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'mapselect-card';
      card.dataset.value = id;

      // Existing location photography introduces the four landscapes.
      const art = document.createElement('span');
      art.className = `mapselect-art mapselect-art-${id}`;
      art.setAttribute('aria-hidden', 'true');

      const name = document.createElement('span');
      name.className = 'mapselect-name';
      name.textContent = region.name;

      const where = document.createElement('span');
      where.className = 'mapselect-where';
      where.textContent = region.where;

      const blurb = document.createElement('span');
      blurb.className = 'mapselect-blurb';
      blurb.textContent = region.blurb;

      card.append(art, name, where, blurb);
      card.onclick = () => {
        haptics.tick();
        this.picked = id;
        this.sync();
      };
      this.cards.appendChild(card);
    }

    this.go = document.createElement('button');
    this.go.type = 'button';
    this.go.className = 'carselect-go';
    this.go.textContent = 'Explore the desert';
    this.go.onclick = () => {
      haptics.tick();
      this.confirm();
    };

    const routes = document.createElement('div');
    routes.className = 'mapselect-route-label';
    routes.textContent = '01 — CHOOSE YOUR LANDSCAPE';
    const footer = document.createElement('p');
    footer.className = 'mapselect-footer';
    footer.textContent = 'No destination required.  /  Keyboard · controller · touch';
    panel.append(eyebrow, title, intro, sub, routes, this.cards, this.go, footer);
    this.element.appendChild(panel);
    this.sync();
  }

  open(): Promise<RegionId> {
    this.element.hidden = false;
    document.body.classList.add('choosing-car');
    requestAnimationFrame(() => this.element.classList.add('is-open'));
    window.addEventListener('keydown', this.onKey);
    return new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  /**
   * Hold the panel up while the engine finishes arriving.
   *
   * The pick resolves the moment it's made — the caller needs it to start
   * building the right region — but the panel can't leave yet, because behind
   * it is an empty canvas rather than a desert. So it stays, with the button
   * saying what it's waiting for.
   */
  waiting(label: string) {
    this.go.disabled = true;
    this.go.textContent = label;
    this.cards.classList.add('is-settled');
  }

  /** Fade out. Deliberately leaves `choosing-car` on the body: the car picker
   *  is next and re-adding it a tick later flashes the driving HUD between. */
  close() {
    this.element.classList.remove('is-open');
    // Left in the DOM until the fade finishes, or it vanishes mid-transition.
    setTimeout(() => { this.element.hidden = true; }, 340);
  }

  private confirm() {
    // Guarded rather than merely idempotent: Enter still reaches the window
    // listener while the panel is held up waiting, and a second resolve would
    // be a second region build.
    const resolve = this.resolve;
    if (!resolve) return;
    this.resolve = null;
    window.removeEventListener('keydown', this.onKey);
    resolve(this.picked);
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
      e.preventDefault();
      this.confirm();
    }
  };

  private sync() {
    this.element.dataset.region = this.picked;
    for (const card of Array.from(this.cards.children) as HTMLElement[]) {
      card.classList.toggle('is-active', card.dataset.value === this.picked);
    }
  }
}
