import type { PoiKind } from '../data/pois';
import { POIS } from '../data/pois';

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

const STORAGE_KEY = 'dune.progress.v1';
const VALID_IDS = new Set<PoiKind>(POIS.map((p) => p.id));

export function loadProgress(): Progress {
  const progress: Progress = { discovered: new Set() };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return progress;
    const saved = JSON.parse(raw) as { discovered?: unknown };
    if (Array.isArray(saved.discovered)) {
      // Same defensiveness as settings: only ids that still exist get adopted,
      // so a stale blob can't make the counter read 12/10.
      for (const id of saved.discovered) {
        if (VALID_IDS.has(id as PoiKind)) progress.discovered.add(id as PoiKind);
      }
    }
  } catch {
    // Unavailable or corrupt storage: a fresh desert is a fine desert.
  }
  return progress;
}

export function saveProgress(progress: Progress): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ discovered: [...progress.discovered] }));
  } catch {
    // Private-mode storage failures aren't worth interrupting a drive over.
  }
}
