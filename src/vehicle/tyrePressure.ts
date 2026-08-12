/**
 * Tyre pressure — the first thing anyone actually does before driving on sand.
 *
 * You stop at the edge of the tarmac and drop from road pressure to around
 * 15 psi. The tyre spreads, the contact patch roughly doubles, and sand that
 * would swallow a hard tyre starts holding you up. Airing back up at the far
 * side is the other half of the ritual. It is the single most characteristic
 * act of dune driving and it was completely absent.
 *
 * As a mechanic it is one control with an honest trade in both directions, no
 * fail state and no score (§11) — it deepens the sand model §2 already has
 * rather than bolting a system alongside it.
 *
 * ## How it works, and why it is mostly one number
 *
 * The traction model already lerps everything it cares about — forward grip,
 * lateral grip, sink drag, climb bleed — along a per-location `softness` term.
 * A wider contact patch does not change what the sand *is*; it changes how soft
 * that sand is *to this tyre*. So the primary effect is a single scale on the
 * softness each wheel reports, and the four consequences fall out for free and
 * stay consistent with each other:
 *
 *   - more grip on soft sand (grip lerps hardpack -> sand by softness)
 *   - less sink drag        (drag is proportional to mean softness)
 *   - less climb bleed      (the climb penalty scales with mean softness)
 *   - and none of it on hardpack, where softness is already ~0
 *
 * Getting that for one multiplier is the whole reason the mechanic is cheap.
 * Everything below it is the cost side, which has to be stated explicitly
 * because nothing in the existing model would ever penalise a soft tyre.
 */

export type PressureId = 'sand' | 'mixed' | 'road';

export interface PressureStep {
  id: PressureId;
  psi: number;
  label: string;
  /** One line for the menu — what you gain, what you give up. */
  hint: string;
}

/**
 * Three steps rather than a slider. The interesting thing about pressure is the
 * decision, not the fine tuning, and a continuous control invites fiddling with
 * a number whose effect you cannot feel at 1 psi resolution. Three states you
 * can name are three states you can form an opinion about.
 */
export const PRESSURE_STEPS: PressureStep[] = [
  { id: 'sand', psi: 15, label: 'Sand', hint: 'Grip and float where it is deep. Slower everywhere else.' },
  { id: 'mixed', psi: 22, label: 'Mixed', hint: 'Competent everywhere, best at nothing.' },
  { id: 'road', psi: 35, label: 'Road', hint: 'Fastest, and sharpest on firm ground. Bogs in deep sand.' },
];

/**
 * Mixed, deliberately. Road pressure would be the realistic arrival state, but
 * it means every player who never finds the control drives the whole game on
 * the setting that is worst at the thing the game is about. Starting in the
 * middle makes both directions a discovery rather than making one of them a
 * correction.
 */
export const DEFAULT_PRESSURE: PressureId = 'mixed';

/** Seconds to move one step. A compressor is not instant, and the pause is
 *  most of what makes it feel like an act rather than a menu toggle. */
export const PRESSURE_RATE = 1.5;

export function isPressureId(v: unknown): v is PressureId {
  return PRESSURE_STEPS.some((s) => s.id === v);
}

export function pressureStep(id: PressureId): PressureStep {
  return PRESSURE_STEPS.find((s) => s.id === id) ?? PRESSURE_STEPS[1];
}

/** Position along the sand -> road axis, 0..1. */
export function pressureAxis(id: PressureId): number {
  const i = PRESSURE_STEPS.findIndex((s) => s.id === id);
  return (i < 0 ? 1 : i) / (PRESSURE_STEPS.length - 1);
}

/**
 * Interpolated psi, for the readout while the tyres are still changing.
 *
 * Piecewise across the steps, not a straight line between the endpoints: the
 * steps are 15/22/35 and are deliberately not evenly spaced, so interpolating
 * end to end put the readout at 25 psi while the menu chip said 22.
 */
export function psiAt(axis: number): number {
  const last = PRESSURE_STEPS.length - 1;
  const t = Math.max(0, Math.min(1, axis)) * last;
  const i = Math.min(last - 1, Math.floor(t));
  return PRESSURE_STEPS[i].psi + (PRESSURE_STEPS[i + 1].psi - PRESSURE_STEPS[i].psi) * (t - i);
}

/**
 * How soft the sand feels to this tyre, as a multiplier on the terrain's own
 * softness. Aired down, deep sand behaves like the firm stuff.
 *
 * The floor sets where airing down starts paying, and it was picked by sweeping
 * the model rather than by driving. At 0.3 the crossover lands at **softness
 * 0.40**: below that, 35 psi has more grip; above it, 15 psi does, and 15 psi
 * has less sink drag everywhere (330 against 1101 at softness 1.0). That split
 * puts the deep dune field on one side and the gravel plains and interdunes on
 * the other, which is the decision the mechanic exists to pose.
 *
 * Worth knowing before re-tuning this by driving around: on *flat* ground the
 * truck is top-speed limited below about 0.8 softness, so traction never binds
 * and a distance-travelled test just measures the top-speed cost — road
 * pressure wins and it looks like the mechanic is backwards. Four separate
 * drive tests said exactly that before the model sweep explained why. The
 * traction advantage only shows up where traction is the limit: bogging, and
 * climbing.
 */
export function softnessScale(axis: number): number {
  return 0.3 + 0.7 * axis;
}

/** Just the fields the pressure model reads. VehicleTuning satisfies it
 *  structurally, so nothing has to be widened to `Record<string, number>`. */
export interface PressureAffected {
  hardpackGrip: number;
  hardpackSideGrip: number;
  topSpeed: number;
  suspensionStiffness: number;
  suspensionCompression: number;
  steerRate: number;
}

/**
 * The costs, applied on top of a body's tuning.
 *
 * All of these run the other way from `softnessScale`, and they have to be
 * written down explicitly: the sand model has no notion of a tyre being *too*
 * soft, so without them airing down would be free and nobody would ever air up.
 *
 * @param axis 0 = 15 psi, 1 = 35 psi.
 */
export function pressureTuning(
  base: PressureAffected,
  axis: number,
): PressureAffected {
  const soft = 1 - axis;
  return {
    // A soft tyre squirms under cornering load on firm ground — the sidewall
    // deflects before the contact patch does anything useful. This is the main
    // reason to air back up.
    //
    // These are the one dishonest part of the model and the comment has to say
    // so: they are applied globally, but the effect they describe only exists
    // on firm ground. The traction model lerps *toward* these values by local
    // softness, so most of the penalty does land where it should — but a truck
    // on deep sand still pays a little of it, which is why they are kept small
    // and why the rolling-resistance term below carries most of the cost of
    // airing down instead.
    hardpackGrip: base.hardpackGrip * (1 - 0.15 * soft),
    hardpackSideGrip: base.hardpackSideGrip * (1 - 0.22 * soft),
    // More rubber on the ground is more rolling resistance and more heat. This
    // one *is* honest everywhere, so it does the heavy lifting.
    topSpeed: base.topSpeed * (1 - 0.18 * soft),
    // The tyre itself becomes part of the suspension: a low-pressure sidewall
    // absorbs the first few centimetres of any hit, which is why airing down
    // makes a hard landing survivable rather than jarring.
    suspensionStiffness: base.suspensionStiffness * (1 - 0.12 * soft),
    suspensionCompression: base.suspensionCompression * (1 + 0.14 * soft),
    // Steering gets heavier and lazier — less self-centring, more slop.
    steerRate: base.steerRate * (1 - 0.14 * soft),
  };
}
