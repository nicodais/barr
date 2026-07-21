import type { JoystickPosition } from '../input/TouchSource';

/**
 * A small collapsible settings control pinned to the top-right on touch devices,
 * letting the player move the thumbstick between bottom-left, -middle and -right
 * while driving (§7). It only makes sense for the joystick scheme, so Game shows
 * it only then; the choice persists like every other setting.
 *
 * It defaults collapsed to a single puck: expanded, its row of options is wide
 * enough to collide with the top-centre speedometer on a narrow phone, so it
 * stays out of the way until tapped and folds back once a position is picked.
 */
const POSITIONS: Array<{ pos: JoystickPosition; glyph: string; title: string }> = [
  { pos: 'left', glyph: '◲', title: 'Stick bottom-left' },
  { pos: 'middle', glyph: '▬', title: 'Stick bottom-middle' },
  { pos: 'right', glyph: '◱', title: 'Stick bottom-right' },
];

const GLYPHS: Record<JoystickPosition, string> = {
  left: '◲',
  middle: '▬',
  right: '◱',
};

export class JoystickBar {
  readonly element: HTMLElement;
  private toggle: HTMLButtonElement;
  private options: HTMLElement;
  private buttons = new Map<JoystickPosition, HTMLButtonElement>();
  private position: JoystickPosition = 'left';
  private expanded = false;

  constructor(private onChange: (pos: JoystickPosition) => void) {
    this.element = document.createElement('div');
    this.element.className = 'joystick-bar collapsed';
    this.element.hidden = true;

    // Collapsed, this is the whole control — it shows where the stick currently
    // sits; expanded, it becomes the fold-away toggle.
    this.toggle = document.createElement('button');
    this.toggle.type = 'button';
    this.toggle.className = 'joystick-bar-toggle';
    this.toggle.onclick = () => this.setExpanded(!this.expanded);
    this.element.appendChild(this.toggle);

    this.options = document.createElement('div');
    this.options.className = 'joystick-bar-options';

    const label = document.createElement('span');
    label.className = 'joystick-bar-label';
    label.textContent = 'Stick';
    this.options.appendChild(label);

    for (const { pos, glyph, title } of POSITIONS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = glyph;
      btn.title = title;
      btn.setAttribute('aria-label', title);
      btn.onclick = () => {
        this.onChange(pos);
        // Fold back once chosen so it can't sit over the speedometer.
        this.setExpanded(false);
      };
      this.buttons.set(pos, btn);
      this.options.appendChild(btn);
    }
    this.element.appendChild(this.options);

    this.setPosition(this.position);
  }

  setPosition(pos: JoystickPosition) {
    this.position = pos;
    for (const [p, btn] of this.buttons) {
      btn.classList.toggle('joystick-bar-active', p === pos);
    }
    this.refreshToggle();
  }

  private setExpanded(expanded: boolean) {
    this.expanded = expanded;
    this.element.classList.toggle('expanded', expanded);
    this.element.classList.toggle('collapsed', !expanded);
    this.refreshToggle();
  }

  /** Collapsed the puck mirrors the current position; expanded it closes. */
  private refreshToggle() {
    this.toggle.textContent = this.expanded ? '×' : GLYPHS[this.position];
    this.toggle.title = this.expanded ? 'Close' : 'Stick position';
    this.toggle.setAttribute('aria-label', this.toggle.title);
    this.toggle.setAttribute('aria-expanded', String(this.expanded));
  }

  show() {
    this.element.hidden = false;
  }

  hide() {
    this.element.hidden = true;
    // Never leave it open when it reappears (photo mode, scheme switches).
    this.setExpanded(false);
  }
}
