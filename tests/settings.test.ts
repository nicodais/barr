import { beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../src/settings/Settings';
import type { GameSettings } from '../src/settings/Settings';
import { DEFAULT_VEHICLE, sanitizeVehicleConfig } from '../src/vehicle/vehicleConfig';
import { installStorage, type MemoryStorage } from './localStorageStub';

/**
 * Settings load, validation and migration.
 *
 * `loadSettings` is 75 lines of hand-written per-field checking, and every one
 * of them exists because the stored blob is untrusted input: it can be old, it
 * can be hand-edited, and it is the one code path in the game that is never
 * exercised by whoever is developing — only by players who already have the
 * previous version's save. `STORAGE_KEY` is at v3, so that migration path is
 * real and has run twice.
 */

const KEY = 'dune.settings.v3';
let store: MemoryStorage;

beforeEach(() => {
  store = installStorage();
});

const write = (blob: unknown) => store.setItem(KEY, JSON.stringify(blob));

describe('loadSettings', () => {
  it('returns defaults with nothing stored', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips a full save', () => {
    const saved: GameSettings = {
      ...DEFAULT_SETTINGS,
      volume: 0.25,
      muted: true,
      region: 'badayer',
      tyrePressure: 'sand',
      quality: 'low',
      textScale: 1.4,
    };
    saveSettings(saved);
    expect(loadSettings()).toEqual(saved);
  });

  it.each(['{', 'null', '[]', '""', '0', 'undefined'])(
    'falls back to defaults on corrupt blob %s',
    (junk) => {
      store.setItem(KEY, junk);
      expect(() => loadSettings()).not.toThrow();
      expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    },
  );

  it('ignores every field that is stored at the wrong type', () => {
    write({
      invertSteering: 'yes',
      muted: 1,
      volume: 'loud',
      musicVolume: null,
      effectsVolume: [],
      touchScheme: 42,
      handedness: {},
      quality: true,
      haptics: 'on',
      region: 7,
      tyrePressure: false,
      dayCycle: 'sometimes',
      textScale: 'big',
      highContrast: 3,
    });
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('rejects non-finite numbers rather than poisoning the audio graph', () => {
    // NaN into a GainNode is not a silent failure, it is silence.
    write({ volume: Number.NaN, musicVolume: Number.POSITIVE_INFINITY });
    const settings = loadSettings();
    expect(settings.volume).toBe(DEFAULT_SETTINGS.volume);
    expect(settings.musicVolume).toBe(DEFAULT_SETTINGS.musicVolume);
  });

  it('clamps volumes into 0..1', () => {
    write({ volume: 40, musicVolume: -3, effectsVolume: 1.5 });
    const settings = loadSettings();
    expect(settings.volume).toBe(1);
    expect(settings.musicVolume).toBe(0);
    expect(settings.effectsVolume).toBe(1);
  });

  it('clamps textScale to the readable range', () => {
    write({ textScale: 99 });
    expect(loadSettings().textScale).toBe(1.6);
    write({ textScale: -99 });
    expect(loadSettings().textScale).toBe(0.8);
  });

  it('drops enum values that no longer exist', () => {
    // The wheel and tilt schemes were cut. A stored 'tilt' must not put the
    // game into a control scheme nothing builds any more.
    write({ touchScheme: 'tilt', quality: 'ultra', region: 'atlantis', tyrePressure: 'flat' });
    const settings = loadSettings();
    expect(settings.touchScheme).toBe(DEFAULT_SETTINGS.touchScheme);
    expect(settings.quality).toBe(DEFAULT_SETTINGS.quality);
    expect(settings.region).toBe(DEFAULT_SETTINGS.region);
    expect(settings.tyrePressure).toBe(DEFAULT_SETTINGS.tyrePressure);
  });

  it('carries a right-handed pre-joystickPosition save over', () => {
    // The documented migration: older saves expressed stick side only through
    // handedness, and those players should not get silently moved.
    write({ handedness: 'right' });
    expect(loadSettings().joystickPosition).toBe('right');
  });

  it('prefers an explicit joystickPosition over the handedness fallback', () => {
    write({ handedness: 'right', joystickPosition: 'left' });
    expect(loadSettings().joystickPosition).toBe('left');
  });

  it('does not let a loaded vehicle write through to DEFAULT_VEHICLE', () => {
    // The hazard the docblock at Settings.ts:106 calls out: the spread is
    // shallow, so without the inner copy the garage panel would edit the
    // module-level defaults in place for the rest of the session.
    const before = { ...DEFAULT_VEHICLE };
    const settings = loadSettings();
    settings.vehicle.body = 'buggy';
    settings.vehicle.paint = 'oxide';
    expect(DEFAULT_VEHICLE).toEqual(before);
    expect(loadSettings().vehicle).toEqual(before);
  });

  it('does not let two loads share one vehicle object', () => {
    const a = loadSettings();
    const b = loadSettings();
    expect(a.vehicle).not.toBe(b.vehicle);
  });
});

describe('saveSettings', () => {
  it('does not interrupt a drive when storage refuses writes', () => {
    store.failWrites = true;
    expect(() => saveSettings(DEFAULT_SETTINGS)).not.toThrow();
  });
});

describe('sanitizeVehicleConfig', () => {
  it('accepts a valid config unchanged', () => {
    const config = { body: 'buggy', paint: 'oxide', wheels: 'beadlock' } as const;
    expect(sanitizeVehicleConfig(config)).toEqual(config);
  });

  it('drops an unknown body rather than shipping an invisible truck', () => {
    // The failure mode the docblock names, and one with no in-game recovery:
    // nothing renders and there is no menu path back.
    expect(sanitizeVehicleConfig({ body: 'spaceship' }).body).toBe(DEFAULT_VEHICLE.body);
  });

  it('keeps the fields it recognises and defaults the rest', () => {
    const config = sanitizeVehicleConfig({ body: 'pickup', paint: 'not-a-colour' });
    expect(config.body).toBe('pickup');
    expect(config.paint).toBe(DEFAULT_VEHICLE.paint);
    expect(config.wheels).toBe(DEFAULT_VEHICLE.wheels);
  });

  it.each([null, undefined, 7, 'pickup', []])('returns defaults for %s', (junk) => {
    expect(sanitizeVehicleConfig(junk)).toEqual(DEFAULT_VEHICLE);
  });

  it('never returns the DEFAULT_VEHICLE object itself', () => {
    expect(sanitizeVehicleConfig({})).not.toBe(DEFAULT_VEHICLE);
  });
});
