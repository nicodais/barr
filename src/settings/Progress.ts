import type { PoiKind } from '../data/pois';
import { activeRegion } from '../terrain/regions';
import { read, write } from './store';

/**
 * Exploration progress, persisted separately from settings (§3): discovery is
 * world-state a returning player has earned, not a preference they can toggle.
 *
 * Only feeds soft systems — the compass stops nudging toward places you've
 * already found and the counter ticks up. Ahmed's call-ins stay once-per-session
 * in the Director: he's a radio cop, he'll comment on your revisit tomorrow,
 * he just won't repeat himself within a drive.
 */
export interface Progress {
  discovered: Set<PoiKind>;
}

const STORAGE_KEY = 'shamal.progress.v1';
// Region-scoped: a save carrying Liwa's discoveries must not have them
// silently count toward Fossil Rock's total, and vice versa.
const validIds = () => new Set<PoiKind>(activeRegion().pois.map((p) => p.id));

export function loadProgress(): Progress {
  const progress: Progress = { discovered: new Set() };
  try {
    const raw = read(STORAGE_KEY);
    if (!raw) return progress;
    const saved = JSON.parse(raw) as { discovered?: unknown };
    if (Array.isArray(saved.discovered)) {
      // Same defensiveness as settings: only ids that still exist get adopted,
      // so a stale blob can't make the counter read 12/10.
      for (const id of saved.discovered) {
        if (validIds().has(id as PoiKind)) progress.discovered.add(id as PoiKind);
      }
    }
  } catch {
    // Unavailable or corrupt storage: a fresh desert is a fine desert.
  }
  return progress;
}

export function saveProgress(progress: Progress): void {
  // `write` swallows its own storage failures and never throws, so there is no
  // try/catch here any more — see settings/store.ts.
  write(STORAGE_KEY, JSON.stringify({ discovered: [...progress.discovered] }));
}
