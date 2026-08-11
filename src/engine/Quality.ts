/**
 * Adaptive quality (§8).
 *
 * Two mechanisms, deliberately asymmetric. A device heuristic picks the opening
 * tier at load, then a frame-time watchdog only ever steps *down*. Automatic
 * upgrades sound appealing but produce a pump: raise quality, drop below the
 * threshold, lower it, recover, raise it again. Downgrade-only converges, and
 * anyone who wants more can pick a tier by hand.
 */
export type QualityTier = 'low' | 'medium' | 'high';

export interface QualityProfile {
  maxPixelRatio: number;
  shadows: boolean;
  shadowMapSize: number;
  /** Metres. Beyond this chunks aren't drawn at all. */
  viewDistance: number;
  /** Distance at which each successive LOD takes over. */
  lodDistances: [number, number, number];
  /** Visual chunk builds allowed per frame. */
  chunkBudget: number;
  maxDust: number;
  /** Crest sand plumes. Cheap enough that even the low tier keeps some. */
  maxPlumes: number;
  /** Sand sloughing down slip faces under the wheels. */
  maxAvalanche: number;
  /** Multiplier on ground-dressing density, 0..1. */
  scatterDensity: number;
  birds: number;
  gazelles: number;
}

export const PROFILES: Record<QualityTier, QualityProfile> = {
  low: {
    maxPixelRatio: 1,
    shadows: false,
    shadowMapSize: 1024,
    viewDistance: 520,
    lodDistances: [140, 280, 430],
    chunkBudget: 1,
    maxDust: 90,
    maxPlumes: 70,
    maxAvalanche: 60,
    scatterDensity: 0.45,
    birds: 5,
    gazelles: 4,
  },
  medium: {
    maxPixelRatio: 1.5,
    shadows: true,
    shadowMapSize: 1024,
    viewDistance: 700,
    lodDistances: [180, 340, 560],
    chunkBudget: 2,
    maxDust: 180,
    maxPlumes: 150,
    maxAvalanche: 130,
    scatterDensity: 0.72,
    birds: 9,
    gazelles: 6,
  },
  high: {
    maxPixelRatio: 2,
    shadows: true,
    shadowMapSize: 2048,
    viewDistance: 900,
    lodDistances: [230, 430, 780],
    chunkBudget: 2,
    maxDust: 320,
    maxPlumes: 260,
    maxAvalanche: 220,
    scatterDensity: 1,
    birds: 14,
    gazelles: 9,
  },
};

export const TIER_ORDER: QualityTier[] = ['low', 'medium', 'high'];

/**
 * Opening guess from what the device tells us about itself. Coarse on purpose —
 * it only has to avoid starting a phone at desktop settings; the watchdog
 * corrects anything this gets wrong within a few seconds.
 */
export function detectTier(): QualityTier {
  const touch = matchMedia('(pointer: coarse)').matches;
  const cores = navigator.hardwareConcurrency ?? 4;
  const dpr = window.devicePixelRatio || 1;
  // A phone pushing a high DPR over a small viewport is the worst case for
  // fill rate, which is what actually costs us here.
  const pixels = window.innerWidth * window.innerHeight * dpr * dpr;

  if (touch) return cores >= 6 && pixels < 4_500_000 ? 'medium' : 'low';
  if (cores <= 4) return 'medium';
  return 'high';
}

export class QualityWatchdog {
  private frames = 0;
  private accum = 0;
  private belowFor = 0;

  /** Frame times above this (ms) count as struggling — roughly 45fps. */
  private static readonly SLOW_MS = 22;
  /** Seconds of sustained slowness before dropping a tier. */
  private static readonly PATIENCE = 4;
  /** Ignore the first moments, where chunk streaming dominates the frame. */
  private grace = 3;

  /** @returns the tier to drop to, or null to stay put. */
  sample(dt: number, tier: QualityTier, manual: boolean): QualityTier | null {
    if (this.grace > 0) {
      this.grace -= dt;
      return null;
    }
    // A hand-picked tier is a decision, not a suggestion.
    if (manual) return null;

    this.accum += dt;
    this.frames++;
    if (this.accum < 1) return null;

    const meanMs = (this.accum / this.frames) * 1000;
    this.accum = 0;
    this.frames = 0;

    this.belowFor = meanMs > QualityWatchdog.SLOW_MS ? this.belowFor + 1 : 0;
    if (this.belowFor < QualityWatchdog.PATIENCE) return null;

    const index = TIER_ORDER.indexOf(tier);
    if (index <= 0) return null;
    this.belowFor = 0;
    return TIER_ORDER[index - 1];
  }

  /** Called after a change so the next judgement starts from a clean slate. */
  reset() {
    this.frames = 0;
    this.accum = 0;
    this.belowFor = 0;
    this.grace = 2;
  }
}
