/**
 * One line that appears, says something that just changed, and leaves.
 *
 * For things the player did not do through the screen and so has no other
 * confirmation of — a controller pairing is the case it was written for (§7).
 * Never interactive and never blocking: it sits above the driving and ignores
 * pointer events entirely.
 */
export class Toast {
  readonly element: HTMLElement;
  private timer = 0;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'toast';
    this.element.setAttribute('role', 'status');
    this.element.hidden = true;
  }

  show(title: string, detail = '', ms = 5200) {
    this.element.replaceChildren();
    const strong = document.createElement('strong');
    strong.textContent = title;
    this.element.appendChild(strong);
    if (detail) {
      const span = document.createElement('span');
      span.textContent = detail;
      this.element.appendChild(span);
    }
    this.element.hidden = false;
    requestAnimationFrame(() => this.element.classList.add('is-open'));
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.element.classList.remove('is-open');
      this.timer = window.setTimeout(() => { this.element.hidden = true; }, 400);
    }, ms);
  }
}
