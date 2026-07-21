import type { Handedness, TouchScheme } from '../input/TouchSource';

/**
 * The one-time touch scheme picker (§7).
 *
 * Shown on the first touch-capable session and never again unless reopened from
 * options. It deliberately does not pause anything or claim the whole screen —
 * dismissing it just leaves you on the default, which is a working scheme.
 */
interface Choice {
  scheme: TouchScheme;
  title: string;
  blurb: string;
}

const CHOICES: Choice[] = [
  { scheme: 'joystick', title: 'Thumbstick', blurb: 'One stick. Push to steer and drive.' },
  { scheme: 'wheel', title: 'Steering wheel', blurb: 'Turn the wheel, tap the pedals.' },
  { scheme: 'tilt', title: 'Tilt', blurb: 'Lean the phone to steer. Pedals on screen.' },
];

export class ControlPicker {
  readonly element: HTMLElement;
  private handedRow: HTMLElement;
  private selected: TouchScheme = 'joystick';
  private handedness: Handedness = 'left';

  constructor(
    private onConfirm: (scheme: TouchScheme, handedness: Handedness) => void,
  ) {
    this.element = document.createElement('div');
    this.element.className = 'picker';
    this.element.hidden = true;

    const card = document.createElement('div');
    card.className = 'picker-card';

    const title = document.createElement('h2');
    title.textContent = 'How do you want to drive?';
    card.appendChild(title);

    const note = document.createElement('p');
    note.className = 'picker-note';
    note.textContent = 'You can change this any time in the tuning panel.';
    card.appendChild(note);

    const list = document.createElement('div');
    list.className = 'picker-options';
    for (const choice of CHOICES) {
      const btn = document.createElement('button');
      btn.className = 'picker-option';
      btn.dataset.scheme = choice.scheme;
      btn.innerHTML = `<strong>${choice.title}</strong><span>${choice.blurb}</span>`;
      btn.onclick = () => {
        this.selected = choice.scheme;
        this.syncSelection(list);
      };
      list.appendChild(btn);
    }
    card.appendChild(list);

    // Handedness only means anything for the thumbstick, so it appears with it.
    this.handedRow = document.createElement('div');
    this.handedRow.className = 'picker-handed';
    for (const hand of ['left', 'right'] as Handedness[]) {
      const btn = document.createElement('button');
      btn.dataset.hand = hand;
      btn.textContent = hand === 'left' ? 'Stick on left' : 'Stick on right';
      btn.onclick = () => {
        this.handedness = hand;
        this.syncSelection(list);
      };
      this.handedRow.appendChild(btn);
    }
    card.appendChild(this.handedRow);

    const go = document.createElement('button');
    go.className = 'picker-go';
    go.textContent = 'Start driving';
    go.onclick = () => {
      this.element.hidden = true;
      this.onConfirm(this.selected, this.handedness);
    };
    card.appendChild(go);

    this.element.appendChild(card);
    this.syncSelection(list);
  }

  open(scheme: TouchScheme, handedness: Handedness) {
    this.selected = scheme;
    this.handedness = handedness;
    const list = this.element.querySelector('.picker-options') as HTMLElement;
    this.syncSelection(list);
    this.element.hidden = false;
  }

  private syncSelection(list: HTMLElement) {
    for (const el of Array.from(list.children) as HTMLElement[]) {
      el.classList.toggle('picker-selected', el.dataset.scheme === this.selected);
    }
    for (const el of Array.from(this.handedRow.children) as HTMLElement[]) {
      el.classList.toggle('picker-selected', el.dataset.hand === this.handedness);
    }
    this.handedRow.hidden = this.selected !== 'joystick';
  }
}
