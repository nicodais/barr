import type { Poi } from './pois';

/**
 * Al Badayer — "Big Red", on the Dubai–Hatta road.
 *
 * The other two regions are places you go to be alone. This one is not, and
 * that is the entire point of it: Al Badayer is where dune bashing actually
 * happens, an hour from the city, busy every weekend, with a petrol station and
 * a quad-hire shack at the entrance. Its POIs are about *people* — the ones who
 * came before you this morning and the ones who have been coming for decades —
 * where Liwa's are about emptiness and Fossil Rock's are about deep time.
 *
 * It also means Ahmed is on much more familiar ground here. In Liwa he is
 * radioing someone who has gone somewhere odd; here he is watching the same
 * dune he watches every weekend, with the weary specificity of a man who has
 * written this report a hundred times.
 */
export const BADAYER_POIS: Poi[] = [
  {
    id: 'famousdune',
    name: 'Big Red',
    // Tracks the great dune in regions.ts — these two must not drift apart.
    x: 150, z: -340, radius: 110,
    lines: [
      "There it is. Every 4x4 in the country has been up that, and about a third of them came back down sideways.",
      "You'll get up it. Everyone does eventually. It's the coming down people misjudge.",
    ],
  },
  {
    id: 'teastand',
    name: 'The Roadside Stand',
    x: -330, z: 210, radius: 62,
    lines: [
      'Now this one is actually open. Weekends he does about two hundred cups before noon.',
      "Tell him Ahmed sent you and he will charge you exactly the same as everyone else.",
    ],
  },
  {
    id: 'oasis',
    name: 'The Date Plot',
    x: -180, z: 330, radius: 70,
    lines: [
      "Somebody's date plot, right where the sand runs out. Been creeping closer every year — the sand, not the dates.",
      'He loses a row a decade and plants another one behind it. Slowest argument in the country.',
    ],
  },
  {
    id: 'cameltrack',
    name: 'The Morning Crossing',
    x: 340, z: 260, radius: 80,
    lines: [
      "Camel crossing. They come through about six, straight over the road, and nobody has ever asked them to stop.",
      'Slow down here even when there is nothing to slow down for. Habit is what saves you at six in the morning.',
    ],
  },
  {
    id: 'majlis',
    name: 'The Weekend Camp',
    x: 420, z: -300, radius: 68,
    lines: [
      "Somebody's weekend majlis. Carpets, a generator, a television nobody watches.",
      'Been the same family every Friday for eleven years. They will wave. Wave back.',
    ],
  },
  {
    id: 'coffeehearth',
    name: 'Last Night’s Fire',
    x: -450, z: -340, radius: 55,
    lines: [
      "Still warm, that one. You have missed them by about four hours.",
      'Out here the fire is the message. Somebody sat, somebody ate, somebody moved on.',
    ],
  },
  {
    id: 'ghaf',
    name: 'The Roadside Ghaf',
    x: 250, z: 470, radius: 60,
    lines: [
      "That ghaf has watched them widen the road twice and it has not moved once.",
      "Protected tree, before you ask. Everything about it is protected. Including from you.",
    ],
  },
  {
    id: 'pylons',
    name: 'The Power Line',
    x: -80, z: -540, radius: 90,
    lines: [
      'Those carry to the whole valley. First thing anyone built out here, and the only thing still doing its job.',
      "When the sand gets over the access track they call me before they call the electricity people. I don't know why either.",
    ],
  },
  {
    id: 'falconry',
    name: 'The Falconer’s Perch',
    x: 520, z: 60, radius: 58,
    lines: [
      'Falconry perch. Early mornings, before it gets hot and before you lot arrive.',
      "A good bird costs more than your vehicle. Try to look impressed if you meet one.",
    ],
  },
];
