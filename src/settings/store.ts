import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

/**
 * The one place persisted state actually touches a storage API.
 *
 * The problem this solves is a mismatch, not a preference. Everything that
 * persists in this game reads its blob synchronously during construction —
 * `loadSettings` runs on the first line of `boot`, `loadProgress` runs inside
 * the Game constructor, `FirstRun` reads in its own constructor — because
 * `localStorage` is synchronous and there was never a reason for it not to be.
 * Capacitor's Preferences API is asynchronous. Threading promises up through
 * three constructors and the boot sequence to satisfy it would be a large,
 * risky change to code that is otherwise fine.
 *
 * So the async part happens exactly once, at a point in `boot` where waiting is
 * free, and everything downstream keeps reading from memory. `hydrate()` pulls
 * every known key into a `Map`; the accessors below are plain synchronous
 * lookups against it; writes update the map immediately and persist in the
 * background.
 *
 * ## Why not just keep localStorage
 *
 * In WKWebView it is evictable. iOS treats webview local storage as cache and
 * can clear it under storage pressure, without warning and without uninstalling
 * anything. A player losing their settings is annoying; losing a garage they
 * built and ten POIs they found is the kind of thing that gets an app a
 * one-star review, and it would happen to a small fraction of players
 * essentially at random. `Preferences` is NSUserDefaults, which is backed up and
 * is not cache.
 *
 * On the web there is no such API and no such problem, so the browser path is
 * unchanged: same `localStorage`, same keys, same behaviour.
 */

/**
 * Every key this game persists, which is deliberately a closed list rather than
 * a free-form string.
 *
 * Hydration has to read the whole set up front — a key nobody declared is a key
 * that reads as empty on native no matter what is stored under it, and the
 * failure looks like "settings randomly reset" rather than like a missing entry
 * here. A union type means adding a store without adding it to this list does
 * not compile.
 *
 * `dune.tuning.v3` is absent on purpose: `TuningPanel` is only constructed under
 * `import.meta.env.DEV` (see Game.ts), so it never exists in a shipped build and
 * has no reason to occupy a slot in the native store.
 */
const KEYS = [
  'dune.settings.v3',
  'dune.progress.v1',
  'dune.seen.v1',
] as const;

export type StoreKey = (typeof KEYS)[number];

const cache = new Map<StoreKey, string>();

/** Native means Preferences; everything else means localStorage. */
const native = Capacitor.isNativePlatform();

/**
 * Serialises writes per key.
 *
 * `Preferences.set` is a promise, and two saves of the same key in quick
 * succession — which happens every time a slider is dragged — are not
 * guaranteed to land in the order they were issued. Chaining each key's writes
 * means the last value set is the last value written, which is the only
 * property that matters here. Nothing awaits this chain: a save that lands a
 * few milliseconds late is invisible, and a save that fails should never
 * interrupt a drive.
 */
const writes = new Map<StoreKey, Promise<void>>();

/**
 * Fills the cache. Must be awaited once, before anything reads.
 *
 * On the web this resolves in a microtask and the `await` costs nothing
 * measurable. On native it is a handful of UserDefaults reads, which is also
 * nothing, but it is genuinely asynchronous and genuinely has to finish first —
 * calling `loadSettings()` before this resolves returns defaults and then
 * cheerfully overwrites the player's real settings with them.
 */
export async function hydrate(): Promise<void> {
  cache.clear();
  for (const key of KEYS) {
    try {
      if (native) {
        const { value } = await Preferences.get({ key });
        if (value !== null) {
          cache.set(key, value);
          continue;
        }
        // Nothing under this key in Preferences. Fall through to the webview's
        // own localStorage, which is where a build of this app made before the
        // move to Preferences would have left it. Not a path from the *website*
        // — an app's webview storage is its own container and cannot see
        // Safari's — so this only ever rescues an in-app upgrade.
        const legacy = localStorage.getItem(key);
        if (legacy !== null) {
          cache.set(key, legacy);
          // Written straight back so the rescue happens once rather than on
          // every launch until something else saves.
          void persist(key, legacy);
        }
      } else {
        const value = localStorage.getItem(key);
        if (value !== null) cache.set(key, value);
      }
    } catch {
      // Storage unavailable or corrupt. Defaults everywhere is a working game,
      // and it is a far better outcome than refusing to boot.
    }
  }
}

/** The stored blob for a key, or null if there isn't one. Synchronous. */
export function read(key: StoreKey): string | null {
  return cache.get(key) ?? null;
}

/** Stores a blob. Returns immediately; the write lands in the background. */
export function write(key: StoreKey, value: string): void {
  cache.set(key, value);
  void persist(key, value);
}

function persist(key: StoreKey, value: string): Promise<void> {
  const next = (writes.get(key) ?? Promise.resolve())
    .then(async () => {
      if (native) await Preferences.set({ key, value });
      else localStorage.setItem(key, value);
    })
    .catch(() => {
      // Private-mode browsers throw on write, and a full disk will throw on
      // native. The in-memory cache is already updated either way, so the
      // session behaves correctly and only the persistence is lost.
    });
  writes.set(key, next);
  return next;
}
