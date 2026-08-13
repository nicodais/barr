import type { Poi } from './pois';

/**
 * Fossil Rock's points of interest.
 *
 * Mleiha is one of the most archaeologically dense places in the Emirates —
 * Umm an-Nar tombs, Iron Age settlement, a pre-Islamic fort — sitting under a
 * limestone ridge full of Cretaceous marine fossils. So this set leans
 * archaeological where Liwa's leans pastoral, which is the honest difference
 * between the two places rather than a variety exercise.
 *
 * The massif is at (210, -170) with a long axis running NNE; everything here is
 * placed around it, and the two rock POIs are on it.
 */
export const FOSSIL_ROCK_POIS: Poi[] = [
  {
    id: 'fossilbed',
    name: 'The Fossil Bed',
    x: 140, z: -60, radius: 80,
    lines: [
      "Look down. Those shells in the rock — this whole ridge was seabed once.",
      'Sixty-five million years, give or take. Take photos, leave the fossils.',
    ],
  },
  {
    id: 'tomb',
    name: 'The Umm an-Nar Tomb',
    x: -290, z: -330, radius: 78,
    lines: [
      'Circular tomb. Four thousand years old, and they buried whole families in it.',
      'Mleiha has hundreds of these. People have been living out here a very long time.',
    ],
  },
  {
    id: 'watchtower',
    name: 'The Mleiha Fort',
    x: 470, z: 250, radius: 80,
    lines: [
      'Pre-Islamic fort. Mud brick, square plan, and it guarded the caravan road east.',
      'Whoever held this held the trade. That is most of the history of this coast.',
    ],
  },
  {
    id: 'ghaf',
    name: 'The Ghaf Stand',
    x: -430, z: 380, radius: 75,
    lines: [
      "That's a ghaf — our national tree. Roots go thirty metres down for water nobody else can reach.",
      'On gravel plain like this they are the only shade for kilometres. Mind the roots.',
    ],
  },
  {
    id: 'falaj',
    name: 'The Buried Falaj',
    x: 620, z: -430, radius: 75,
    lines: [
      "That's a falaj — hand-dug channels that carried water for miles, back before anyone had pipes.",
      'Iron Age engineering, and the sand has been swallowing this one for two thousand years.',
    ],
  },
  {
    id: 'teastand',
    name: "Ahmed's Other Tea Stand",
    x: -620, z: -140, radius: 70,
    lines: [
      "Yes, I have one here too. Different desert, same karak.",
      "Don't look so surprised. A man covers a large patch.",
    ],
  },
  {
    id: 'coffeehearth',
    name: 'The Camp Hearth',
    x: 300, z: 590, radius: 60,
    lines: [
      "Someone's old coffee fire. Out here you never once refused a traveller his gahwa.",
      'Ruler or lost stranger, same pot, same welcome. That rule is older than the borders are.',
    ],
  },
  // Three more, to bring this region up to the ten the other two carry. All
  // sited off the massif: the rock already had two and the rest of the map had
  // almost nothing, so the drive out to the plain had no reason on it.
  {
    id: 'famousdune',
    name: 'The Ramp',
    x: 60, z: -150, radius: 95,
    lines: [
      "That's the only way up the rock that isn't a cliff, and everyone who comes here finds it eventually.",
      'Carry your speed at the bottom. Halfway up is a bad place to change your mind.',
    ],
  },
  {
    id: 'cameltrack',
    name: 'The Old Race Track',
    x: -400, z: 480, radius: 85,
    lines: [
      'Camel track. The races are serious business — the winners get bred like royalty.',
      'This stretch got left to the sand when they built the big ovals. Mind the old rails.',
    ],
  },
  {
    id: 'falconry',
    name: 'The Ridge Perch',
    x: 470, z: -420, radius: 62,
    lines: [
      'Falconers work this side of the ridge. Updraft off the scarp does half the work for the bird.',
      "Been done here a very long time. Longer than the ridge has had a name, probably.",
    ],
  },
];
