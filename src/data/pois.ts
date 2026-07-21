/**
 * The seven points of interest for v1 (§5), mixing grounded/historical spots
 * with a couple of playful ones so the world has texture without becoming a
 * checklist. Nothing here is mandatory and nothing gates movement.
 *
 * Coordinates stay inside ±730 so landmarks never end up buried in the rising
 * rim of dunes that closes off the region.
 */
export type PoiKind =
  | 'falaj'
  | 'ghaf'
  | 'watchtower'
  | 'campsite'
  | 'pylons'
  | 'teastand'
  | 'famousdune';

export interface Poi {
  id: PoiKind;
  name: string;
  x: number;
  z: number;
  /** Ahmed keys up inside this radius, in metres. */
  radius: number;
  /** Written specifically for this spot — never interchangeable filler (§13). */
  line: string;
}

export const POIS: Poi[] = [
  {
    id: 'falaj',
    name: 'The Old Falaj',
    x: -600, z: -170, radius: 75,
    line: "That's the falaj. Older than the road you didn't take to get here.",
  },
  {
    id: 'ghaf',
    name: 'Ghaf Tree Ridge',
    x: 150, z: 700, radius: 75,
    line: "That tree's older than both of us. Don't be the reason it isn't anymore.",
  },
  {
    id: 'watchtower',
    name: 'The Watchtower Ruin',
    x: 600, z: 470, radius: 80,
    line: 'Old watchtower. Whoever built it had a better view than my station does.',
  },
  {
    id: 'campsite',
    name: 'Old Campsite Ruins',
    x: -250, z: -620, radius: 70,
    line: 'People lived out here before air conditioning existed. Show some respect.',
  },
  {
    id: 'pylons',
    name: 'The Survey Pylons',
    x: 660, z: -640, radius: 85,
    line: 'Seventies oil survey. They were wrong. Markers stayed anyway.',
  },
  {
    id: 'teastand',
    name: "Ahmed's Tea Stand",
    x: -680, z: 600, radius: 70,
    line: "That's my actual tea stand. If I'm not on shift, I'm probably right there.",
  },
  {
    id: 'famousdune',
    name: 'The Famous Dune',
    x: 470, z: -260, radius: 95,
    line: 'This dune has more photos of it than my entire family. I never understood why.',
  },
];
