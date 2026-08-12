import { REGIONS, REGION_ORDER, type RegionId } from '../terrain/regions';

/**
 * Where you're driving today.
 *
 * Runs ahead of the car picker, because the region decides what the height
 * field *is* — picking it before the truck is built means one clean teardown at
 * boot rather than a rebuild a second later, and it reads in the right order
 * too: you choose where you're going, then what you're taking.
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

  constructor(initial: RegionId) {
    this.picked = initial;

    this.element = document.createElement('div');
    this.element.className = 'carselect mapselect';
    this.element.hidden = true;

    const panel = document.createElement('div');
    panel.className = 'carselect-panel';

    const title = document.createElement('h1');
    title.className = 'carselect-title';
    title.textContent = 'Where are we going?';

    const sub = document.createElement('p');
    sub.className = 'carselect-sub';
    sub.textContent = 'Two deserts, and they drive nothing like each other.';

    this.cards = document.createElement('div');
    this.cards.className = 'mapselect-cards';
    for (const id of REGION_ORDER) {
      const region = REGIONS[id];
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'mapselect-card';
      card.dataset.value = id;

      // A drawn thumbnail rather than a photo: the rest of the game is
      // flat-shaded and a photograph on the front of it would set an
      // expectation the world then fails to meet.
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
        this.picked = id;
        this.sync();
      };
      this.cards.appendChild(card);
    }

    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'carselect-go';
    go.textContent = 'Drive there';
    go.onclick = () => this.confirm();

    panel.append(title, sub, this.cards, go);
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

  private confirm() {
    window.removeEventListener('keydown', this.onKey);
    this.element.classList.remove('is-open');
    document.body.classList.remove('choosing-car');
    // Left in the DOM until the fade finishes, or it vanishes mid-transition.
    setTimeout(() => { this.element.hidden = true; }, 340);
    this.resolve?.(this.picked);
    this.resolve = null;
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
      e.preventDefault();
      this.confirm();
    }
  };

  private sync() {
    for (const card of Array.from(this.cards.children) as HTMLElement[]) {
      card.classList.toggle('is-active', card.dataset.value === this.picked);
    }
  }
}
