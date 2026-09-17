import { POI_PHOTOS } from './poiPhotos';
import type { Poi } from './pois';

/**
 * Lahbab Red Desert — inland Dubai, on the edge of the conservation reserve.
 *
 * Where Liwa's POIs are about emptiness, Fossil Rock's about deep time, and
 * Badayer's about the private weekend crowd, Lahbab's are about the
 * commercial safari industry that actually runs out of here — tour Land
 * Cruisers, evening BBQ camps, professional drivers — because this is the
 * closest serious dune field to the city. The skyline being close enough to
 * matter is the throughline; even the reserve-boundary post and the falconry
 * ground are here *because* civilisation is right there.
 */
export const LAHBAB_POIS: Poi[] = [
  // Tracks the great dune in regions.ts — these two must not drift apart.
  {
    id: 'famousdune',
    name: 'The Wall',
    x: 200, z: 260, radius: 100,
    lines: [
      "That's the one the professional drivers actually test their line on, not the one they let the tourists near.",
      "Steepest climb in any of the four deserts. Get a proper run at it, habibi, or don't bother.",
    ],
    // Not Tal Moreeb and not Big Red — a different dune with a different
    // reputation, so the shared card would say something untrue here.
    info: {
      title: 'The Wall',
      body:
        'Lahbab\'s steepest dune, and the one the tour-company drivers use to test a new ' +
        'truck before it goes anywhere near a paying customer. No queue at the bottom like ' +
        'Big Red\'s — the people who come here already know what they are doing.',
      ...POI_PHOTOS.lahbab,
    },
  },
  {
    id: 'pylons',
    name: 'The City Feed',
    x: -520, z: -380, radius: 90,
    lines: [
      "Those don't stop at some farmhouse. Follow them far enough and they feed the whole skyline.",
      'Closest thing to civilisation you will see out here. Which is not saying very much.',
    ],
    // Badayer's transmission line feeds a valley; this one is a different
    // scale of thing entirely.
    info: {
      title: 'The Transmission Line',
      body:
        'Part of the grid that feeds Dubai rather than a single valley — the load on these ' +
        'towers is a different order of magnitude from a rural corridor, which is most of ' +
        'why they are here at all: the city is close enough that running power out this far ' +
        'was worth doing.',
      ...POI_PHOTOS.pylons,
    },
  },
  {
    id: 'majlis',
    name: 'The Safari Camp',
    x: 420, z: -180, radius: 75,
    lines: [
      'Empty right now. Wait for sunset — forty coach-loads of dinner turn up at once.',
      "Barbecue, camel rides, someone's cousin doing the drumming. Every tourist in Dubai has been to a version of this.",
    ],
    info: {
      title: 'The Safari Camp',
      body:
        'A commercial evening camp rather than a family majlis — carpets, a stage, a dinner ' +
        'buffet, timed to the sunset drive. Dozens of these operate out of Lahbab, because it ' +
        'is close enough to the city to make it back for the second seating.',
      ...POI_PHOTOS.safaricamp,
    },
  },
  {
    id: 'teastand',
    name: "The Drivers' Stop",
    x: -300, z: 480, radius: 60,
    lines: [
      "That one's for the safari drivers, not the tourists. Different prices, better tea.",
      'They trade gossip about whose Land Cruiser broke a shackle this week.',
    ],
  },
  {
    id: 'falconry',
    name: "The Falconer's Ground",
    x: 550, z: 320, radius: 65,
    lines: [
      'Away from the camps, this is where the serious falconers actually fly their birds.',
      "Every camp down the road has one on a perch for the photo. This is where the real training happens.",
    ],
  },
  {
    id: 'cameltrack',
    name: 'The Racing Track',
    x: -480, z: 150, radius: 90,
    lines: [
      'Camel racing track. Robot jockeys now — little ones, radio-controlled, strapped to the hump.',
      "Faster than you'd think. Sillier than you'd think, too.",
    ],
  },
  {
    id: 'coffeehearth',
    name: 'The Quiet Fire',
    x: 80, z: -520, radius: 55,
    lines: [
      'Someone still comes all the way out here just to sit, away from every camp.',
      "Desert's still a desert, even with this much traffic running through it.",
    ],
  },
  {
    id: 'ghaf',
    name: 'The Boundary Tree',
    x: -150, z: -280, radius: 60,
    lines: [
      'That ghaf marks the reserve line. Development stops there because the tree, officially, says so.',
      "Skyline's crept up behind it for twenty years. The tree hasn't moved an inch.",
    ],
  },
  // Reused as a modern reserve lookout rather than an old raider-watching
  // tower — the shared card is about the wrong kind of watching entirely.
  {
    id: 'watchtower',
    name: 'The Reserve Post',
    x: 350, z: 550, radius: 80,
    lines: [
      'Conservation reserve starts past that fence. Oryx, gazelle, the lot.',
      'Ironic, wallah — the animals get the quiet half of the desert and you lot get the loud half.',
    ],
    info: {
      title: 'The Reserve Post',
      body:
        'A lookout post on the Dubai Desert Conservation Reserve boundary, not a historic ' +
        'watchtower — this one is decades old, not centuries, and it watches for animals ' +
        'straying out rather than raiders coming in.',
      ...POI_PHOTOS.reserve,
    },
  },
];
