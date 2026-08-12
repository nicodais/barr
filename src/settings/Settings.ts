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
import { isRegionId, type RegionId } from '../terrain/regions';
import { DEFAULT_PRESSURE, isPressureId, type PressureId } from '../vehicle/tyrePressure';
import {
  DEFAULT_VEHICLE,
  sanitizeVehicleConfig,
  type VehicleConfig,
} from '../vehicle/vehicleConfig';

export interface GameSettings {
  /** Mirrors steering input for players who prefer it the other way round. */
  invertSteering: boolean;
  muted: boolean;
  /** Master volume, 0..1. */
  volume: number;
  /** Trim on the score, 0..1. Independent of the adaptive swell. */
  musicVolume: number;
  /** Trim on engine, tyres, wind and impacts, 0..1. */
  effectsVolume: number;
  touchScheme: TouchScheme;
  handedness: Handedness;
  /** Where the on-screen thumbstick sits on touch devices. */
  joystickPosition: JoystickPosition;
  /** False until the one-time scheme picker has been answered (§7). */
  touchPickerSeen: boolean;
  /** 'auto' lets the device heuristic and watchdog decide. */
  quality: QualityTier | 'auto';
  /** Phone vibration on landings, rollovers and radio calls. Mobile only. */
  haptics: boolean;
  /** Body, paint and fitted accessories. Cosmetic only — never handling. */
  vehicle: VehicleConfig;
  /** Which desert. Restored on load so you come back where you left off. */
  region: RegionId;
  /** Tyre pressure. Persisted because it is a driving preference, not a
   *  per-session accident — someone who likes it aired down always does. */
  tyrePressure: PressureId;
}

export const DEFAULT_SETTINGS: GameSettings = {
  invertSteering: true,
  muted: false,
  volume: 0.9,
  // The score sits forward and the vehicle sits back, because the brief is
  // decompression (§1) and the oud is doing most of that work. The vehicle
  // still has to be legible — the engine note is how you read the traction
  // model by ear — so it is trimmed rather than pushed under.
  musicVolume: 1,
  effectsVolume: 0.7,
  touchScheme: 'joystick',
  handedness: 'left',
  joystickPosition: 'left',
  touchPickerSeen: false,
  quality: 'auto',
  // On by default: it only ever fires on devices that have a motor, the cues
  // are short, and someone who dislikes it will find the switch in the menu
  // faster than someone who'd enjoy it would go looking for one that's off.
  haptics: true,
  vehicle: DEFAULT_VEHICLE,
  region: 'liwa',
  tyrePressure: DEFAULT_PRESSURE,
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
//
// v2 -> v3 for the music/effects split. Not strictly required — the two new
// keys are simply absent from a v2 blob and fall back to their defaults — but
// the old mix had the score 10-20dB under the vehicle, and anyone who dragged
// the master volume up to compensate has a stored value that is now much too
// loud. Resetting once is kinder than shipping them a wall of noise.
const STORAGE_KEY = 'dune.settings.v3';

export function loadSettings(): GameSettings {
  // The spread is shallow, so `vehicle` would otherwise be the *same object* as
  // DEFAULT_VEHICLE — the garage panel edits settings in place, which would
  // then quietly rewrite the defaults for the rest of the session.
  const settings = { ...DEFAULT_SETTINGS, vehicle: { ...DEFAULT_VEHICLE } };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
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
    if (typeof saved.musicVolume === 'number' && Number.isFinite(saved.musicVolume)) {
      settings.musicVolume = Math.min(1, Math.max(0, saved.musicVolume));
    }
    if (typeof saved.effectsVolume === 'number' && Number.isFinite(saved.effectsVolume)) {
      settings.effectsVolume = Math.min(1, Math.max(0, saved.effectsVolume));
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
    if (typeof saved.haptics === 'boolean') {
      settings.haptics = saved.haptics;
    }
    // Per-field validation lives with the catalogue it validates against, since
    // that's what has to be edited when a body or swatch is added or retired.
    if (saved.vehicle) {
      settings.vehicle = sanitizeVehicleConfig(saved.vehicle);
    }
    if (isRegionId(saved.region)) {
      settings.region = saved.region;
    }
    if (isPressureId(saved.tyrePressure)) {
      settings.tyrePressure = saved.tyrePressure;
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
