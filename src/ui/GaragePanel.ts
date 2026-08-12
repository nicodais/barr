import type { GameSettings } from '../settings/Settings';
import { saveSettings } from '../settings/Settings';
import {
  BODY_OPTIONS,
  PAINT_OPTIONS,
  WHEEL_OPTIONS,
  type VehicleConfig,
} from '../vehicle/vehicleConfig';
import { buildChoice } from './controls';


/**
 * Only kit that survives the chase camera is offered. Anything that lives under
 * the truck or inside the cabin is invisible in the one view the player spends
 * the whole session in, so it would be a menu entry that appears to do nothing.
 */

/**
 * The garage: body, paint, wheels and kit (§4 visual choices only — none of
 * this reaches the vehicle controller).
 *
 * Every change rebuilds the truck's mesh, which is not free, so the panel
 * reports changes rather than being polled: nothing here runs per frame.
 */
export class GaragePanel {
  readonly element: HTMLElement;
  private visible = false;

  constructor(
    private settings: GameSettings,
    private onChange: () => void,
  ) {
    this.element = document.createElement('aside');
    // Borrows the tuning panel's chrome deliberately: same corner, same shape,
    // so switching between the two doesn't feel like two different apps.
    this.element.className = 'tuning-panel garage-panel';
    this.element.hidden = true;

    const header = document.createElement('header');
    header.innerHTML = '<strong>Garage</strong><span>G to hide</span>';
    this.element.appendChild(header);

    const body = document.createElement('div');
    body.className = 'tuning-body';
    this.element.appendChild(body);

    const bodySection = this.section(body, 'Body');
    bodySection.appendChild(
      buildChoice(
        'Shape',
        BODY_OPTIONS.map((o) => ({ value: o.id, label: o.label })),
        () => this.config.body,
        (v) => this.set({ body: v as VehicleConfig['body'] }),
      ),
    );

    const paintSection = this.section(body, 'Paint');
    paintSection.appendChild(this.buildSwatches());

    const wheelSection = this.section(body, 'Wheels');
    wheelSection.appendChild(
      buildChoice(
        'Rims',
        WHEEL_OPTIONS.map((o) => ({ value: o.id, label: o.label })),
        () => this.config.wheels,
        (v) => this.set({ wheels: v as VehicleConfig['wheels'] }),
      ),
    );

    const actions = document.createElement('div');
    actions.className = 'tuning-actions';
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Close';
    close.onclick = () => this.hide();
    actions.appendChild(close);
    this.element.appendChild(actions);
  }

  private get config(): VehicleConfig {
    return this.settings.vehicle;
  }

  private section(parent: HTMLElement, title: string): HTMLElement {
    const section = document.createElement('section');
    const h = document.createElement('h3');
    h.textContent = title;
    section.appendChild(h);
    parent.appendChild(section);
    return section;
  }

  /**
   * Colour is picked from the colour itself, not from a name in a segmented
   * list — the whole question is how a swatch looks on sand, and eight text
   * labels answer none of it.
   */
  private buildSwatches(): HTMLElement {
    const grid = document.createElement('div');
    grid.className = 'garage-swatches';

    const sync = () => {
      for (const el of Array.from(grid.children) as HTMLElement[]) {
        el.classList.toggle('is-active', el.dataset.value === this.config.paint);
      }
    };

    for (const paint of PAINT_OPTIONS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.value = paint.id;
      btn.title = paint.label;
      btn.setAttribute('aria-label', paint.label);
      btn.style.setProperty('--swatch', `#${paint.color.toString(16).padStart(6, '0')}`);
      btn.onclick = () => {
        this.set({ paint: paint.id });
        sync();
        name.textContent = paint.label;
      };
      grid.appendChild(btn);
    }
    sync();

    const row = document.createElement('div');
    row.className = 'tuning-row tuning-choice';
    const name = document.createElement('span');
    name.className = 'tuning-name';
    name.textContent =
      PAINT_OPTIONS.find((p) => p.id === this.config.paint)?.label ?? 'Paint';
    row.append(name, grid);
    return row;
  }

  private set(patch: Partial<VehicleConfig>) {
    Object.assign(this.settings.vehicle, patch);
    saveSettings(this.settings);
    this.onChange();
  }

  toggle() {
    if (this.visible) this.hide();
    else this.show();
  }

  show() {
    this.visible = true;
    this.element.hidden = false;
  }

  hide() {
    this.visible = false;
    this.element.hidden = true;
  }
}
