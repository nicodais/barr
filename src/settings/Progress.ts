import type { PoiKind } from '../data/pois';
import { activeRegion } from '../terrain/regions';

/**
 * Exploration progress, persisted separately from settings (§3): discovery is
 * world-state a returning player has earned, not a preference they can toggle.
 *
 * Only feeds soft systems — the compass stops nudging toward places you've
 * already found and the counter ticks up. Ahmed's call-ins stay once-per-session
 * in the Director: he's a radio cop, he'll comment on your revisit tomorrow,
 * he just won't repeat himself within a drive.
 *
 * ## One key per region, and why the old single key was wrong
 *
 * `PoiKind` is a shared catalogue — a ghaf is a ghaf in any emirate — so most
 * kinds appear in more than one region. Storing every discovery in one flat
 * array therefore could not tell "found the ghaf in Liwa" from "found the ghaf
 * at Fossil Rock", and filtering that array against the active region on load
 * did not fix it. It broke twice:
 *
 *  - **False credit.** Find the ghaf and the falaj in Liwa, drive to Fossil
 *    Rock, and both ids survive the filter because Fossil Rock has its own ghaf
 *    and falaj. You arrived at a desert you had never driven with two of ten
 *    already counted and the compass refusing to point at either.
 *  - **Silent deletion.** From there, find `fossilbed` — Fossil Rock only — and
 *    go back to Liwa. Load drops it, because it is not a Liwa kind. The next
 *    discovery in Liwa saves the filtered set back over the key, and the fossil
 *    bed is gone from disk for good.
 *
 * The key carries the region now, so the two deserts cannot see each other's
 * saves at all. The per-region id filter stays, because it is still the right
 * defence against a *stale* blob naming a POI that region has since retired.
 */
export interface Progress {
  discovered: Set<PoiKind>;
}

const KEY_PREFIX = 'dune.progress.v2';
/**
 * The single-key format described above. Read once and retired: its contents
 * belong to whichever region the player was last in, which is exactly the
 * region `activeRegion()` reports at first load, since settings persist it and
 * `setActiveRegion` runs before this does.
 */
const LEGACY_KEY = 'dune.progress.v1';

const storageKey = () => `${KEY_PREFIX}.${activeRegion().id}`;
const validIds = () => new Set<PoiKind>(activeRegion().pois.map((p) => p.id));

/** Only ids this region still builds get adopted, so a stale blob can't make the counter read 12/10. */
function adopt(raw: string | null, into: Progress) {
  if (!raw) return;
  const saved = JSON.parse(raw) as { discovered?: unknown };
  if (!Array.isArray(saved.discovered)) return;
  const valid = validIds();
  for (const id of saved.discovered) {
    if (valid.has(id as PoiKind)) into.discovered.add(id as PoiKind);
  }
}

export function loadProgress(): Progress {
  const progress: Progress = { discovered: new Set() };
  try {
    const key = storageKey();
    const raw = localStorage.getItem(key);
    if (raw !== null) {
      adopt(raw, progress);
      return progress;
    }
    // No save for this region yet. If a legacy blob is still around it is this
    // region's history, so take it over and drop it — migrating once rather
    // than leaving it to be re-read by whichever region is opened next.
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy !== null) {
      adopt(legacy, progress);
      localStorage.removeItem(LEGACY_KEY);
      saveProgress(progress);
    }
  } catch {
    // Unavailable or corrupt storage: a fresh desert is a fine desert.
  }
  return progress;
}

export function saveProgress(progress: Progress): void {
  try {
    localStorage.setItem(storageKey(), JSON.stringify({ discovered: [...progress.discovered] }));
  } catch {
    // Private-mode storage failures aren't worth interrupting a drive over.
  }
}
