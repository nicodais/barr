/**
 * The points of interest (§5).
 *
 * `PoiKind` is a shared catalogue rather than a per-region list: the kind is
 * what decides which landmark gets built and which info card is shown, and both
 * of those are exhaustive switches. A region picks which kinds it places and
 * where, so a watchtower can stand in two deserts without either file learning
 * that regions exist.
 *
 * Liwa's set leans into the desert heritage of the UAE — the falaj that carried
 * water, the majlis where a ruler held open council, the ghaf the Sheikhs
 * planted a country out of, falconry and the camel track — plus a couple of
 * playful, present-day spots so the world has texture without becoming a
 * checklist. Nothing is mandatory and nothing gates movement.
 *
 * Coordinates stay well inside the soft fade-and-respawn boundary (~760 out, see
 * WorldBoundary) so landmarks sit in the curated heart of the region, never out
 * in the endless dune field the player only skims before being turned back.
 *
 * `lines` is an ordered pool, not a random one: Ahmed keys up once and delivers
 * them as consecutive beats — usually "what it is", then "why it matters" — so a
 * spot can carry its meaning while every individual line stays a one-liner (§13).
 */
import type { PoiInfo } from './poiInfo';

export type PoiKind =
  | 'falaj'
  | 'ghaf'
  | 'watchtower'
  | 'majlis'
  // Two different things that both happen to be steel in the sand, and which
  // were one kind until the card started lying about one of them: `oilwell` is
  // a dry 1960s exploration well — a derrick over a plugged hole — and `pylons`
  // is a live transmission line. Sharing a kind meant sharing a landmark, so
  // Liwa's oil survey was built out of power pylons and strung with cable.
  | 'oilwell'
  | 'pylons'
  | 'teastand'
  | 'famousdune'
  | 'falconry'
  | 'cameltrack'
  | 'coffeehearth'
  | 'oasis'
  // Fossil Rock only.
  | 'fossilbed'
  | 'tomb';

export interface Poi {
  id: PoiKind;
  name: string;
  x: number;
  z: number;
  /** Ahmed keys up inside this radius, in metres. */
  radius: number;
  /** Ordered beats for this spot — played in sequence, never interchangeable (§13). */
  lines: string[];
  /**
   * Overrides for the arrival card, merged over the per-kind entry in
   * POI_INFO.
   *
   * The card is keyed by *kind*, which is right for the encyclopaedic ones — a
   * ghaf tree is a ghaf tree in any emirate, and "The Ghaf Tree" is a better
   * card title than whatever the local place is called. It stops being right
   * when a region reuses a kind for a spot the shared text does not describe:
   * Big Red is not Tal Moreeb, and Fossil Rock's Ramp is not a famous dune at
   * all, it is the one climbable line up a jebel.
   *
   * Where two regions' spots are factually *different things* rather than
   * differently-named examples of one thing, they get different kinds instead —
   * an override cannot fix the landmark that gets built, only the words next to
   * it. That is why the dry well and the power line are no longer one kind.
   *
   * Only set this where the shared card would state something untrue about
   * this particular spot.
   */
  info?: Partial<PoiInfo>;
}

export const LIWA_POIS: Poi[] = [
  {
    id: 'falaj',
    name: 'The Old Falaj',
    x: -600, z: -170, radius: 75,
    lines: [
      "That's a falaj — hand-dug channels that carried water for miles, back before anyone had pipes.",
      'Whole villages lived or died on that water. Older than the road you skipped to get here.',
    ],
  },
  {
    id: 'ghaf',
    name: 'Ghaf Tree Ridge',
    x: 150, z: 700, radius: 75,
    lines: [
      "That's a ghaf — our national tree. Roots go thirty metres down for water nobody else can reach.",
      'The old Sheikh greened a whole country out of trees like this one. Don\'t be the reason it isn\'t here.',
    ],
  },
  {
    id: 'watchtower',
    name: 'The Watchtower Ruin',
    x: 600, z: 470, radius: 80,
    lines: [
      "Old watchtower. A Sheikh's men sat up there watching the trade roads for raiders.",
      'Kept the caravans safe for a share of the goods. Whole desert ran on trust and a good view.',
    ],
  },
  {
    id: 'majlis',
    name: 'The Ruler\'s Majlis',
    x: -250, z: -620, radius: 75,
    lines: [
      'This was a majlis — the Sheikh held council right here, out in the open sand.',
      'No walls, no guards. Anyone could sit, speak their case, and get coffee doing it. That was the point.',
    ],
  },
  {
    id: 'oilwell',
    name: 'The Dry Well',
    x: 660, z: -640, radius: 85,
    lines: [
      'Old exploration well. They drilled half this desert chasing the stuff that built the country.',
      'This one came up dry. Capped the hole and left — dragging the derrick out was more trouble than it was worth.',
    ],
  },
  {
    id: 'teastand',
    name: "Ahmed's Tea Stand",
    x: -680, z: 600, radius: 70,
    lines: [
      "That's my actual tea stand. If I'm not on shift, I'm probably right there.",
      "Karak's still on the stove. Don't touch it.",
    ],
  },
  // Tal Moreeb. Sits on the summit, so the card is what's waiting at the top of
  // the climb rather than something collected at the bottom — and the radius is
  // kept tight for the same reason.
  {
    id: 'famousdune',
    name: 'Tal Moreeb',
    x: 310, z: -218, radius: 70,
    lines: [
      'Tal Moreeb. Three hundred metres of sand, and every year people race cars straight up it.',
      'You got up. Most people need a run-up and a second go. Sit a minute — the view is the point.',
    ],
  },
  {
    id: 'falconry',
    name: 'The Falconry Ground',
    x: -330, z: 300, radius: 78,
    lines: [
      'Falcons were trained here. Al Qannas — falconry — is as old as the tribes themselves.',
      'The Sheikhs kept it alive on purpose. Out here a good bird was worth more than a camel.',
    ],
  },
  {
    id: 'cameltrack',
    name: 'The Old Camel Track',
    x: -120, z: 525, radius: 120,
    lines: [
      'Camel track. The races are serious business — the Sheikhs breed the winners like royalty.',
      'This stretch got left to the sand when they built the big ovals. Mind the old rails.',
    ],
  },
  // The oasis sits in a genuinely enclosed interdune hollow — the flattest,
  // lowest, most sheltered ground within 350m of anything else, found by
  // sampling the height field rather than picked by eye. That matters: a date
  // garden only exists where the water table comes near the surface, which out
  // here means the bottom of a basin.
  {
    id: 'oasis',
    name: 'The Date Garden',
    x: 190, z: -580, radius: 80,
    lines: [
      "Dates. Out here. That's not luck — the water sits close under this hollow.",
      'Liwa is a string of these. Whole villages grew out of gardens the size of this one.',
    ],
  },
  {
    id: 'coffeehearth',
    name: 'The Desert Coffee Hearth',
    x: -110, z: -380, radius: 60,
    lines: [
      "Someone's old coffee fire. Out here you never once refused a traveller his gahwa.",
      'Ruler or lost stranger, same pot, same welcome. That rule is older than the borders are.',
    ],
  },
];
