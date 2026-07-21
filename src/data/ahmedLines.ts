/**
 * Ahmed's line pool (§13).
 *
 * He's a working police officer covering the dune-bashing stretch, not a ranger
 * or a guide — tired, dry, teasing from familiarity rather than contempt. The
 * humour lands on specificity, never on the accent or the Arabic.
 *
 * Format rules that the Director enforces: one-liners only, never blocking, and
 * a line is retired for the session once used so a drive doesn't repeat itself.
 */
export type LinePool =
  | 'signOn'
  | 'stuck'
  | 'fast'
  | 'airborne'
  | 'rollover'
  | 'signOff';

export const AHMED_LINES: Record<LinePool, string[]> = {
  signOn: [
    "Ahmed. Radio check. You're still upright, I hope.",
    "Nobody's called this in yet, so either you're fine or you're just not answering.",
    'Quiet day. Try to keep it that way.',
    "Nice of you to actually go where the road isn't.",
  ],
  stuck: [
    'That’s sand. It does that.',
    "Reverse, then forward. It's not a puzzle.",
    "I've written this exact report eleven times this month.",
  ],
  fast: [
    "Slow down. This isn't a rally.",
    'Mashallah. Still, slow down.',
  ],
  airborne: [
    "I saw that jump. I'm choosing to ignore it.",
    'Wallah, if you land that wrong I am not driving out there.',
  ],
  rollover: [
    "Khalas. Happens to everyone. Mostly out there, apparently.",
    "You're the right way up again. Let's agree not to discuss it.",
  ],
  signOff: [
    'Ahmed out. Try not to need me again today.',
    'Khalas. Go on then.',
    "I've got tea waiting. Drive safe, habibi.",
  ],
};
