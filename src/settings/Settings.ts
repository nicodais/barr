/**
 * Player settings, persisted to localStorage (§3). Kept separate from
 * VehicleTuning: tuning is developer-facing numbers that get baked into the
 * build once they feel right, settings are player choices that must survive it.
 *
 * Grows into the phase 5 options menu; for now the tuning panel is the only UI
 * surface that exists to host it.
 */
import type { Handedness, JoystickPosition, TouchScheme } from '../input/TouchSource';
import type { QualityTier } from '../engine/Quality';

export interface GameSettings {
  /** Mirrors steering input for players who prefer it the other way round. */
  invertSteering: boolean;
  muted: boolean;
  /** Master volume, 0..1. */
  volume: number;
  touchScheme: TouchScheme;
  handedness: Handedness;
  /** Where the on-screen thumbstick sits on touch devices. */
  joystickPosition: JoystickPosition;
  /** False until the one-time scheme picker has been answered (§7). */
  touchPickerSeen: boolean;
  /** 'auto' lets the device heuristic and watchdog decide. */
  quality: QualityTier | 'auto';
}

export const DEFAULT_SETTINGS: GameSettings = {
  invertSteering: true,
  muted: false,
  volume: 0.9,
  touchScheme: 'joystick',
  handedness: 'left',
  joystickPosition: 'left',
  touchPickerSeen: false,
  quality: 'auto',
};

// Joystick only: the wheel and tilt schemes were cut, so any stored value
// other than 'joystick' falls back to the default rather than resurrecting them.
const TOUCH_SCHEMES: TouchScheme[] = ['joystick'];
const HANDEDNESS: Handedness[] = ['left', 'right'];
const JOYSTICK_POSITIONS: JoystickPosition[] = ['left', 'middle', 'right'];
const QUALITIES: Array<QualityTier | 'auto'> = ['auto', 'low', 'medium', 'high'];

// Bumped v1 -> v2 so the inverted-steering default reaches returning players:
// a v1 blob saved before that default flipped would otherwise pin steering to
// its old, non-inverted value. The bump resets every persisted setting once.
const STORAGE_KEY = 'inthebarr.settings.v2';
/** Pre-rename keys, read once so players keep their settings across renames. */
const LEGACY_KEYS = ['goingbarr.settings.v2', 'dune.settings.v2'];

export function loadSettings(): GameSettings {
  const settings = { ...DEFAULT_SETTINGS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? LEGACY_KEYS.map((k) => localStorage.getItem(k)).find(Boolean) ?? null;
    if (!raw) return settings;
    const saved = JSON.parse(raw) as Partial<GameSettings>;
    // Only adopt keys we still recognise, and only at the right type, so an
    // old or hand-edited blob can't inject junk into the input path.
    if (typeof saved.invertSteering === 'boolean') {
      settings.invertSteering = saved.invertSteering;
    }
    if (typeof saved.muted === 'boolean') {
      settings.muted = saved.muted;
    }
    if (typeof saved.volume === 'number' && Number.isFinite(saved.volume)) {
      settings.volume = Math.min(1, Math.max(0, saved.volume));
    }
    // Enum-valued settings are checked against the allowed set rather than just
    // their type, so a stale or hand-edited blob can't put the game into a
    // scheme that no longer exists.
    if (saved.touchScheme && TOUCH_SCHEMES.includes(saved.touchScheme)) {
      settings.touchScheme = saved.touchScheme;
    }
    if (saved.handedness && HANDEDNESS.includes(saved.handedness)) {
      settings.handedness = saved.handedness;
    }
    if (saved.joystickPosition && JOYSTICK_POSITIONS.includes(saved.joystickPosition)) {
      settings.joystickPosition = saved.joystickPosition;
    } else if (saved.handedness === 'right') {
      // Pre-joystickPosition saves only expressed left/right through handedness;
      // carry a right-handed stick over so those players don't get moved.
      settings.joystickPosition = 'right';
    }
    if (typeof saved.touchPickerSeen === 'boolean') {
      settings.touchPickerSeen = saved.touchPickerSeen;
    }
    if (saved.quality && QUALITIES.includes(saved.quality)) {
      settings.quality = saved.quality;
    }
  } catch {
    // Unavailable or corrupt storage: defaults are already in place.
  }
  return settings;
}

export function saveSettings(settings: GameSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private-mode storage failures aren't worth interrupting a drive over.
  }
}
