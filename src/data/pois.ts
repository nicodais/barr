/**
 * The points of interest for v1 (§5). A curated set that leans into the desert
 * heritage of the UAE — the falaj that carried water, the majlis where a ruler
 * held open council, the ghaf the Sheikhs planted a country out of, falconry and
 * the camel track — plus a couple of playful, present-day spots so the world has
 * texture without becoming a checklist. Nothing here is mandatory and nothing
 * gates movement.
 *
 * Coordinates stay well inside the soft fade-and-respawn boundary (~760 out, see
 * WorldBoundary) so landmarks sit in the curated heart of the region, never out
 * in the endless dune field the player only skims before being turned back.
 *
 * `lines` is an ordered pool, not a random one: Ahmed keys up once and delivers
 * them as consecutive beats — usually "what it is", then "why it matters" — so a
 * spot can carry its meaning while every individual line stays a one-liner (§13).
 */
export type PoiKind =
  | 'falaj'
  | 'ghaf'
  | 'watchtower'
  | 'majlis'
  | 'pylons'
  | 'teastand'
  | 'famousdune'
  | 'falconry'
  | 'cameltrack'
  | 'coffeehearth'
  | 'fossilridge';

export interface Poi {
  id: PoiKind;
  name: string;
  x: number;
  z: number;
  /** Ahmed keys up inside this radius, in metres. */
  radius: number;
  /** Ordered beats for this spot — played in sequence, never interchangeable (§13). */
  lines: string[];
}

export const POIS: Poi[] = [
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
    id: 'pylons',
    name: 'The Survey Pylons',
    x: 660, z: -640, radius: 85,
    lines: [
      'Seventies oil survey. They marked the whole desert up, chasing the stuff that built the country.',
      'This patch came up dry. Markers stayed anyway — the wealth was just somewhere else.',
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
  {
    id: 'famousdune',
    name: 'The Famous Dune',
    x: 470, z: -260, radius: 95,
    lines: [
      'This dune has more photos of it than my entire family. I never understood why.',
      'People drive two hours to stand on sand that looks like all the other sand. Mashallah.',
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
  {
    id: 'coffeehearth',
    name: 'The Desert Coffee Hearth',
    x: -110, z: -380, radius: 60,
    lines: [
      "Someone's old coffee fire. Out here you never once refused a traveller his gahwa.",
      'Ruler or lost stranger, same pot, same welcome. That rule is older than the borders are.',
    ],
  },
  // The only POI you have to *climb* to. It sits on the summit shelf of the
  // fossil ridge, and the radius is deliberately tight — tight enough that the
  // ramp doesn't trigger it, so the card is the thing waiting at the top rather
  // than something you collect on the way past the bottom.
  {
    id: 'fossilridge',
    name: 'Fossil Ridge',
    x: 337, z: -591, radius: 55,
    lines: [
      "You made it up. Look at the rock — those are seashells. All this was seabed once.",
      'Seventy million years of geology, and everyone still just photographs their car on it.',
    ],
  },
];
