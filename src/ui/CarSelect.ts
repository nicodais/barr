import {
  BODY_OPTIONS,
  PAINT_OPTIONS,
  WHEEL_OPTIONS,
  type VehicleConfig,
} from '../vehicle/vehicleConfig';
import { haptics } from '../input/Haptics';


/**
 * The car you pick before you start driving.
 *
 * Sits between the loader and the first frame you control (§5's "no forced
 * structure" doesn't mean no moment to choose a truck — it means nothing gates
 * you once you're out there). Three decisions shape it:
 *
 *  - **The preview is the real vehicle in the real world**, on a slow turntable
 *    under the actual desert light rather than on a grey card. Picking a paint
 *    that vanishes against red sand is a mistake you should be able to see
 *    before committing to it, and the only honest way to show that is on sand.
 *  - **It never blocks.** Everything on it is optional and there's a default
 *    already chosen, so hitting Enter or clicking straight through is a complete
 *    interaction. Nobody should have to read a spec sheet to go for a drive.
 *  - **The same choices stay reachable later** from the garage panel, so this is
 *    a starting point rather than the one chance to get it right.
 */
export class CarSelect {
  readonly element: HTMLElement;
  private bodyList: HTMLElement;
  private swatches: HTMLElement;
  private resolve: (() => void) | null = null;

  constructor(
    private config: VehicleConfig,
    private onChange: () => void,
  ) {
    this.element = document.createElement('div');
    this.element.className = 'carselect';
    this.element.hidden = true;

    const panel = document.createElement('div');
    panel.className = 'carselect-panel';

    const title = document.createElement('h1');
    title.className = 'carselect-title';
    title.textContent = 'Pick your truck';

    const sub = document.createElement('p');
    sub.className = 'carselect-sub';
    sub.textContent = 'They handle differently. Pick one and head out — you can swap later.';

    this.bodyList = document.createElement('div');
    this.bodyList.className = 'carselect-bodies';
    for (const option of BODY_OPTIONS) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'carselect-card';
      card.dataset.value = option.id;

      const name = document.createElement('span');
      name.className = 'carselect-card-name';
      name.textContent = option.label;

      const blurb = document.createElement('span');
      blurb.className = 'carselect-card-blurb';
      blurb.textContent = option.blurb;

      // Stat bars, on every card at once rather than only the selected one.
      // The question this screen answers is "which of these do I want", and
      // that is a comparison — showing one car's numbers at a time turns it
      // into four separate readings the player has to hold in their head.
      const stats = document.createElement('div');
      stats.className = 'carselect-stats';
      for (const [key, value] of Object.entries(option.stats)) {
        const stat = document.createElement('div');
        stat.className = 'carselect-stat';
        const label = document.createElement('span');
        label.textContent = key;
        const track = document.createElement('div');
        track.className = 'carselect-bar';
        const fill = document.createElement('i');
        fill.style.width = `${Math.round(value * 100)}%`;
        track.appendChild(fill);
        stat.append(label, track);
        stats.appendChild(stat);
      }

      card.append(name, blurb, stats);
      card.onclick = () => {
        haptics.tick();
        this.config.body = option.id;
        this.sync();
        this.onChange();
      };
      this.bodyList.appendChild(card);
    }

    // Paint, as swatches. A list of colour *names* is unreadable when the whole
    // point is which one you like looking at.
    const paintRow = document.createElement('div');
    paintRow.className = 'carselect-section';
    const paintLabel = document.createElement('span');
    paintLabel.className = 'carselect-label';
    paintLabel.textContent = 'Paint';
    this.swatches = document.createElement('div');
    this.swatches.className = 'carselect-swatches';
    for (const paint of PAINT_OPTIONS) {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'carselect-swatch';
      dot.dataset.value = paint.id;
      dot.title = paint.label;
      dot.style.background = `#${paint.color.toString(16).padStart(6, '0')}`;
      dot.onclick = () => {
        haptics.tick();
        this.config.paint = paint.id;
        this.sync();
        this.onChange();
      };
      this.swatches.appendChild(dot);
    }
    paintRow.append(paintLabel, this.swatches);

    const kit = document.createElement('div');
    kit.className = 'carselect-kit';
    kit.append(this.buildWheelChoice());

    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'carselect-go';
    go.textContent = 'Head out';
    go.onclick = () => {
      haptics.tick();
      this.confirm();
    };

    const hint = document.createElement('p');
    hint.className = 'carselect-hint';
    hint.textContent = 'You can change all of this later — press G for the garage.';

    panel.append(title, sub, this.bodyList, paintRow, kit, go, hint);
    this.element.appendChild(panel);
    this.sync();
  }

  private buildWheelChoice(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'carselect-section';
    const label = document.createElement('span');
    label.className = 'carselect-label';
    label.textContent = 'Wheels';
    const group = document.createElement('div');
    group.className = 'tuning-segments';
    for (const wheel of WHEEL_OPTIONS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.value = wheel.id;
      btn.textContent = wheel.label;
      btn.onclick = () => {
        haptics.tick();
        this.config.wheels = wheel.id;
        this.sync();
        this.onChange();
      };
      group.appendChild(btn);
    }
    row.append(label, group);
    return row;
  }

  /** Marks the current choices active across every control on the screen. */
  private sync() {
    for (const el of Array.from(this.bodyList.children) as HTMLElement[]) {
      el.classList.toggle('is-active', el.dataset.value === this.config.body);
    }
    for (const el of Array.from(this.swatches.children) as HTMLElement[]) {
      el.classList.toggle('is-active', el.dataset.value === this.config.paint);
    }
    for (const group of Array.from(this.element.querySelectorAll('.tuning-segments'))) {
      for (const el of Array.from(group.children) as HTMLElement[]) {
        el.classList.toggle('is-active', el.dataset.value === this.config.wheels);
      }
    }
  }

  /** Resolves once the player has committed, so the caller can hand over control. */
  open(): Promise<void> {
    this.element.hidden = false;
    // Deferred a frame so the fade-in has a starting state to animate from.
    requestAnimationFrame(() => this.element.classList.add('is-open'));
    window.addEventListener('keydown', this.onKey);
    return new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  private confirm() {
    window.removeEventListener('keydown', this.onKey);
    this.element.classList.remove('is-open');
    // Left in the DOM until the fade finishes, then taken out of the layout so
    // it can never eat a pointer event aimed at the touch controls underneath.
    setTimeout(() => { this.element.hidden = true; }, 420);
    this.resolve?.();
    this.resolve = null;
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.code === 'Enter' || e.code === 'Space' || e.code === 'Escape') {
      e.preventDefault();
      this.confirm();
    }
  };
}
