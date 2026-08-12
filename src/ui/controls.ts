/**
 * The handful of plain-DOM widgets the option surfaces are built from. Shared
 * so the garage and the tuning panel can't drift into two different-looking
 * sets of toggles and segmented buttons sitting one keypress apart.
 */

export interface ChoiceOption {
  value: string;
  label: string;
}

export function buildToggle(
  label: string,
  get: () => boolean,
  set: (value: boolean) => void,
): HTMLElement {
  const row = document.createElement('label');
  row.className = 'tuning-row tuning-toggle';

  const name = document.createElement('span');
  name.className = 'tuning-name';
  name.textContent = label;

  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = get();
  box.onchange = () => set(box.checked);

  row.append(name, box);
  return row;
}

/** A small segmented control for enum-valued settings. */
export function buildChoice(
  label: string,
  options: ChoiceOption[],
  get: () => string,
  set: (value: string) => void,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'tuning-row tuning-choice';

  const name = document.createElement('span');
  name.className = 'tuning-name';
  name.textContent = label;

  const group = document.createElement('div');
  group.className = 'tuning-segments';
  const sync = () => {
    for (const el of Array.from(group.children) as HTMLElement[]) {
      el.classList.toggle('is-active', el.dataset.value === get());
    }
  };
  for (const option of options) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.value = option.value;
    btn.textContent = option.label;
    btn.onclick = () => {
      set(option.value);
      sync();
    };
    group.appendChild(btn);
  }
  sync();

  row.append(name, group);
  return row;
}

/** Turns a plain list of enum values into options labelled with themselves. */
export function plainOptions(values: readonly string[]): ChoiceOption[] {
  return values.map((value) => ({ value, label: value }));
}
