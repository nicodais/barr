import type { JoystickPosition } from '../input/TouchSource';

/**
 * A small settings bar pinned to the top-right on touch devices, letting the
 * player move the thumbstick between bottom-left, -middle and -right while
 * driving (§7). It only makes sense for the joystick scheme, so Game shows it
 * only then; the choice persists like every other setting.
 */
const POSITIONS: Array<{ pos: JoystickPosition; label: string; title: string }> = [
  { pos: 'left', label: '◲', title: 'Stick bottom-left' },
  { pos: 'middle', label: '▬', title: 'Stick bottom-middle' },
  { pos: 'right', label: '◱', title: 'Stick bottom-right' },
];

export class JoystickBar {
  readonly element: HTMLElement;
  private buttons = new Map<JoystickPosition, HTMLButtonElement>();

  constructor(private onChange: (pos: JoystickPosition) => void) {
    this.element = document.createElement('div');
    this.element.className = 'joystick-bar';
    this.element.hidden = true;

    const label = document.createElement('span');
    label.className = 'joystick-bar-label';
    label.textContent = 'Stick';
    this.element.appendChild(label);

    for (const { pos, label: glyph, title } of POSITIONS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = glyph;
      btn.title = title;
      btn.setAttribute('aria-label', title);
      btn.onclick = () => this.onChange(pos);
      this.buttons.set(pos, btn);
      this.element.appendChild(btn);
    }
  }

  setPosition(pos: JoystickPosition) {
    for (const [p, btn] of this.buttons) {
      btn.classList.toggle('joystick-bar-active', p === pos);
    }
  }

  show() {
    this.element.hidden = false;
  }

  hide() {
    this.element.hidden = true;
  }
}
