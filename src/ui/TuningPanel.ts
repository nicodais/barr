import type { TimeOfDay } from '../engine/TimeOfDay';
import type { GameSettings } from '../settings/Settings';
import { saveSettings } from '../settings/Settings';
import type { VehicleTuning } from '../vehicle/VehicleTuning';
import { DEFAULT_TUNING } from '../vehicle/VehicleTuning';

interface Slider {
  key: keyof VehicleTuning;
  label: string;
  min: number;
  max: number;
  step: number;
}

interface Section {
  title: string;
  sliders: Slider[];
}

/**
 * §2 says the driving feel gets iterated by playtesting, not by chasing specs.
 * That only works if changing a value takes a second, so every feel parameter
 * is a live slider — no rebuild, no reload, no losing your position on the dune.
 */
const SECTIONS: Section[] = [
  {
    title: 'Chassis',
    sliders: [
      { key: 'gravity', label: 'Gravity (m/s²)', min: 9.81, max: 26, step: 0.1 },
      { key: 'mass', label: 'Mass (kg)', min: 900, max: 3500, step: 25 },
      { key: 'comHeight', label: 'CoM drop', min: 0, max: 0.9, step: 0.01 },
      { key: 'rollInertia', label: 'Roll inertia', min: 300, max: 4000, step: 25 },
      { key: 'pitchInertia', label: 'Pitch inertia', min: 800, max: 8000, step: 50 },
      { key: 'yawInertia', label: 'Yaw inertia', min: 800, max: 8000, step: 50 },
    ],
  },
  {
    title: 'Suspension',
    sliders: [
      { key: 'suspensionRest', label: 'Rest length', min: 0.15, max: 0.9, step: 0.01 },
      { key: 'suspensionStiffness', label: 'Stiffness', min: 5, max: 80, step: 0.5 },
      { key: 'suspensionCompression', label: 'Damp (bump)', min: 0.1, max: 8, step: 0.05 },
      { key: 'suspensionRelaxation', label: 'Damp (rebound)', min: 0.1, max: 10, step: 0.05 },
      { key: 'suspensionTravel', label: 'Max travel', min: 0.05, max: 0.7, step: 0.01 },
      { key: 'maxSuspensionForce', label: 'Max force', min: 10000, max: 200000, step: 1000 },
    ],
  },
  {
    title: 'Drivetrain',
    sliders: [
      { key: 'engineForce', label: 'Engine force', min: 500, max: 9000, step: 50 },
      { key: 'topSpeed', label: 'Top speed (m/s)', min: 10, max: 60, step: 1 },
      { key: 'brakeForce', label: 'Brake', min: 300, max: 9000, step: 50 },
      { key: 'handbrakeForce', label: 'Handbrake', min: 300, max: 12000, step: 50 },
      { key: 'reverseForce', label: 'Reverse', min: 300, max: 5000, step: 50 },
      { key: 'engineBrake', label: 'Engine brake', min: 0, max: 2500, step: 20 },
      { key: 'parkBrake', label: 'Park brake', min: 0, max: 8000, step: 50 },
    ],
  },
  {
    title: 'Steering',
    sliders: [
      { key: 'maxSteerAngle', label: 'Max lock (rad)', min: 0.15, max: 1.0, step: 0.01 },
      { key: 'highSpeedSteerFactor', label: 'Lock @ speed', min: 0.05, max: 1.0, step: 0.01 },
      { key: 'steerRate', label: 'Steer rate', min: 0.5, max: 12, step: 0.1 },
    ],
  },
  {
    title: 'Sand & tyres',
    sliders: [
      { key: 'hardpackGrip', label: 'Grip: hardpack', min: 0.2, max: 8, step: 0.05 },
      { key: 'sandGrip', label: 'Grip: soft sand', min: 0.1, max: 5, step: 0.05 },
      { key: 'hardpackSideGrip', label: 'Side: hardpack', min: 0.1, max: 3, step: 0.05 },
      { key: 'sandSideGrip', label: 'Side: soft sand', min: 0.05, max: 2, step: 0.05 },
      { key: 'rearGripBias', label: 'Rear grip (drift)', min: 0.3, max: 1.0, step: 0.01 },
      { key: 'yawAssist', label: 'Yaw assist', min: 0, max: 6, step: 0.1 },
      { key: 'maxYawRate', label: 'Max yaw (rad/s)', min: 0.3, max: 2.5, step: 0.05 },
      { key: 'slopeGripLoss', label: 'Slope grip loss', min: 0, max: 0.9, step: 0.01 },
      { key: 'sinkDrag', label: 'Sink drag', min: 0, max: 4000, step: 25 },
      { key: 'climbBleed', label: 'Climb bleed', min: 0, max: 2.5, step: 0.05 },
    ],
  },
  {
    title: 'Rollover',
    sliders: [
      { key: 'rollThreshold', label: 'Trigger (up.y)', min: -0.5, max: 0.7, step: 0.01 },
      { key: 'rollRecoverDelay', label: 'Recover delay (s)', min: 0.1, max: 4, step: 0.1 },
    ],
  },
];

/**
 * Bump this whenever the *meaning* of the numbers changes, not just their
 * values. v1 was authored against 9.81 gravity; letting a saved v1 set restore
 * over v2 defaults would pair old force values with heavy gravity and quietly
 * make dune faces unclimbable — the exact failure this rescale exists to avoid.
 */
const STORAGE_KEY = 'dune.tuning.v3';

export class TuningPanel {
  readonly element: HTMLElement;
  private inputs = new Map<keyof VehicleTuning, { range: HTMLInputElement; readout: HTMLElement }>();
  private visible = false;

  constructor(
    private tuning: VehicleTuning,
    private settings: GameSettings,
    private timeOfDay: TimeOfDay,
    private onChange: () => void,
    private onAudioChange: () => void,
    private onQualityChange: () => void,
    private onTouchChange: () => void,
  ) {
    this.element = document.createElement('aside');
    this.element.className = 'tuning-panel';
    this.element.hidden = true;

    const header = document.createElement('header');
    header.innerHTML = '<strong>Tuning &amp; controls</strong><span>T to hide</span>';
    this.element.appendChild(header);

    const body = document.createElement('div');
    body.className = 'tuning-body';
    this.element.appendChild(body);

    // Player settings first: unlike the physics values below, these are meant
    // to be changed by whoever is driving, not just whoever is tuning.
    const controls = document.createElement('section');
    const controlsTitle = document.createElement('h3');
    controlsTitle.textContent = 'Controls';
    controls.appendChild(controlsTitle);
    controls.appendChild(
      this.buildToggle(
        'Invert steering',
        () => this.settings.invertSteering,
        (v) => {
          this.settings.invertSteering = v;
          saveSettings(this.settings);
        },
      ),
    );
    controls.appendChild(
      this.buildToggle(
        'Mute audio',
        () => this.settings.muted,
        (v) => {
          this.settings.muted = v;
          saveSettings(this.settings);
          this.onAudioChange();
        },
      ),
    );
    controls.appendChild(
      this.buildFreeSlider('Volume', 0, 1, 0.01, () => this.settings.volume, (v) => {
        this.settings.volume = v;
        saveSettings(this.settings);
        this.onAudioChange();
      }),
    );
    controls.appendChild(
      this.buildChoice(
        'Quality',
        ['auto', 'low', 'medium', 'high'],
        () => this.settings.quality,
        (v) => {
          this.settings.quality = v as GameSettings['quality'];
          saveSettings(this.settings);
          this.onQualityChange();
        },
      ),
    );
    if (matchMedia('(pointer: coarse)').matches) {
      controls.appendChild(
        this.buildChoice(
          'Stick position',
          ['left', 'middle', 'right'],
          () => this.settings.joystickPosition,
          (v) => {
            this.settings.joystickPosition = v as GameSettings['joystickPosition'];
            saveSettings(this.settings);
            this.onTouchChange();
          },
        ),
      );
    }
    body.appendChild(controls);

    // Time of day is an art-direction dial, so it wants to be scrubbable rather
    // than something you wait 20 minutes to see.
    const light = document.createElement('section');
    const lightTitle = document.createElement('h3');
    lightTitle.textContent = 'Time of day';
    light.appendChild(lightTitle);
    light.appendChild(
      this.buildFreeSlider('Hour', 0, 1, 0.005, () => this.timeOfDay.time, (v) => {
        this.timeOfDay.time = v;
        this.timeOfDay.update(0);
      }, formatClock),
    );
    light.appendChild(
      this.buildToggle(
        'Advance automatically',
        () => this.timeOfDay.autoAdvance,
        (v) => { this.timeOfDay.autoAdvance = v; },
      ),
    );
    body.appendChild(light);

    for (const section of SECTIONS) {
      const group = document.createElement('section');
      const title = document.createElement('h3');
      title.textContent = section.title;
      group.appendChild(title);
      for (const slider of section.sliders) {
        group.appendChild(this.buildSlider(slider));
      }
      body.appendChild(group);
    }

    const actions = document.createElement('div');
    actions.className = 'tuning-actions';

    const resetBtn = document.createElement('button');
    resetBtn.textContent = 'Reset defaults';
    resetBtn.onclick = () => {
      Object.assign(this.tuning, DEFAULT_TUNING);
      localStorage.removeItem(STORAGE_KEY);
      this.syncInputs();
      this.onChange();
    };

    const copyBtn = document.createElement('button');
    copyBtn.textContent = 'Copy values';
    copyBtn.onclick = async () => {
      const text = JSON.stringify(this.tuning, null, 2);
      try {
        await navigator.clipboard.writeText(text);
        copyBtn.textContent = 'Copied';
      } catch {
        // Clipboard is permission-gated; the console is a fine fallback.
        console.log(text);
        copyBtn.textContent = 'Logged to console';
      }
      setTimeout(() => (copyBtn.textContent = 'Copy values'), 1400);
    };

    actions.append(resetBtn, copyBtn);
    this.element.appendChild(actions);

    this.load();
    this.syncInputs();
  }

  private buildToggle(
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
  private buildChoice(
    label: string,
    options: string[],
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
      btn.dataset.value = option;
      btn.textContent = option;
      btn.onclick = () => {
        set(option);
        sync();
      };
      group.appendChild(btn);
    }
    sync();

    row.append(name, group);
    return row;
  }

  /** A slider bound to arbitrary get/set rather than a VehicleTuning key. */
  private buildFreeSlider(
    label: string,
    min: number,
    max: number,
    step: number,
    get: () => number,
    set: (value: number) => void,
    display: (value: number) => string = format,
  ): HTMLElement {
    const row = document.createElement('label');
    row.className = 'tuning-row';

    const name = document.createElement('span');
    name.className = 'tuning-name';
    name.textContent = label;

    const readout = document.createElement('span');
    readout.className = 'tuning-value';
    readout.textContent = display(get());

    const range = document.createElement('input');
    range.type = 'range';
    range.min = String(min);
    range.max = String(max);
    range.step = String(step);
    range.value = String(get());
    range.oninput = () => {
      const v = Number(range.value);
      set(v);
      readout.textContent = display(v);
    };

    row.append(name, readout, range);
    return row;
  }

  private buildSlider(spec: Slider): HTMLElement {
    const row = document.createElement('label');
    row.className = 'tuning-row';

    const name = document.createElement('span');
    name.className = 'tuning-name';
    name.textContent = spec.label;

    const readout = document.createElement('span');
    readout.className = 'tuning-value';

    const range = document.createElement('input');
    range.type = 'range';
    range.min = String(spec.min);
    range.max = String(spec.max);
    range.step = String(spec.step);
    range.oninput = () => {
      const v = Number(range.value);
      (this.tuning[spec.key] as number) = v;
      readout.textContent = format(v);
      this.save();
      this.onChange();
    };

    row.append(name, readout, range);
    this.inputs.set(spec.key, { range, readout });
    return row;
  }

  private syncInputs() {
    for (const [key, { range, readout }] of this.inputs) {
      const v = this.tuning[key] as number;
      range.value = String(v);
      readout.textContent = format(v);
    }
  }

  toggle() {
    this.visible = !this.visible;
    this.element.hidden = !this.visible;
  }

  private save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.tuning));
    } catch {
      // Private-mode storage failures are not worth interrupting a drive over.
    }
  }

  private load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as Partial<VehicleTuning>;
      // Only adopt keys we still recognise, so an old blob can't inject junk.
      for (const key of Object.keys(DEFAULT_TUNING) as Array<keyof VehicleTuning>) {
        const v = saved[key];
        if (typeof v === 'number' && Number.isFinite(v)) {
          (this.tuning[key] as number) = v;
        }
      }
      this.onChange();
    } catch {
      // Corrupt blob: defaults are already in place.
    }
  }
}

/** Renders the 0..1 day cycle as a wall clock, with 0 = midnight. */
function formatClock(v: number): string {
  const totalMinutes = Math.round(v * 24 * 60) % (24 * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function format(v: number): string {
  if (Math.abs(v) >= 1000) return v.toFixed(0);
  if (Math.abs(v) >= 10) return v.toFixed(1);
  return v.toFixed(2);
}
