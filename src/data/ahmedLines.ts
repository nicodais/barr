/**
 * Ahmed's line pool (§13).
 *
 * He's a working police officer covering the dune-bashing stretch, not a ranger
 * or a guide — tired, dry, teasing from familiarity rather than contempt. The
 * humour lands on specificity, never on the accent or the Arabic.
 *
 * Format rules that the Director enforces: one-liners only, never blocking, and
 * a line is retired for the session once used so a drive doesn't repeat itself.
 *
 * ## Pool sizes are a design constraint, not an accident
 *
 * The Director retires a line once used and only recycles when a pool is
 * exhausted, so a pool of two repeats on the *second* occurrence of whatever
 * triggers it. Jumping a dune twice is not a rare event. Every pool here is
 * sized against how often its trigger actually fires: `airborne` and `fast`
 * happen constantly and need depth, `stormIn` happens twice an hour and does
 * not. Anything under four lines for a common trigger is a bug in waiting.
 *
 * ## §12, resolved: he never learns your name
 *
 * The open question was whether he addresses the player by name or nickname.
 * He stays generic, and rotates through *habibi*, *ya sir*, *my friend* and
 * *champion* instead. A real name would need asking for, and a text field
 * between the player and the desert is exactly the kind of friction §1 exists
 * to avoid; a fixed name would be wrong for everyone who isn't called it. The
 * rotating address does the warmth the name was wanted for, and costs nothing.
 */
export type LinePool =
  | 'signOn'
  | 'stuck'
  | 'fast'
  | 'airborne'
  | 'rollover'
  | 'stormIn'
  | 'stormOut'
  | 'airedDown'
  | 'airedUp'
  | 'pressureHint'
  | 'signOff';

export const AHMED_LINES: Record<LinePool, string[]> = {
  signOn: [
    "Ahmed. Radio check. You're still upright, I hope.",
    "Nobody's called this in yet, so either you're fine or you're just not answering.",
    'Quiet day. Try to keep it that way.',
    "Nice of you to actually go where the road isn't.",
    "Ahmed here. The air conditioning at the station is broken, so I'm taking an interest in your day.",
    "You're the fourth one out here today. The other three are fine. So far.",
    "Radio's on. I'm not going anywhere and neither is my tea.",
    'Morning. Afternoon. Out here it stops mattering by about ten.',
  ],
  stuck: [
    'That’s sand. It does that.',
    "Reverse, then forward. It's not a puzzle.",
    "I've written this exact report eleven times this month.",
    "Off the throttle, ya sir. You're digging, not driving.",
    'Rock it. Back, forward, back. Slowly.',
    'Everyone gets stuck. Not everyone manages it there.',
    'Keep that foot down and you will reach Oman. Downwards.',
  ],
  fast: [
    "Slow down. This isn't a rally.",
    'Mashallah. Still, slow down.',
    "There's nobody out here to overtake, champion.",
    'Nothing you are late for is in that direction.',
    "I can hear that from here, and I'm inside a building.",
    'The dunes have been here nine thousand years. They will wait.',
  ],
  airborne: [
    "I saw that jump. I'm choosing to ignore it.",
    'Wallah, if you land that wrong I am not driving out there.',
    'Both axles off the ground. Very good. Very stupid.',
    "That's the second one. I stopped counting after the second one.",
    'You know the suspension is not free, habibi.',
    "Beautiful. Don't tell anyone I said that.",
  ],
  rollover: [
    'Khalas. Happens to everyone. Mostly out there, apparently.',
    "You're the right way up again. Let's agree not to discuss it.",
    'That was a side slope. Side slopes do that. Every time.',
    "Roof, sand, roof, sand. Yes. I've seen it.",
    'Nothing broken. Nothing ever is. Carry on.',
    "I'd ask if you're alright but you're already driving again.",
  ],
  // The shamal coming up and going down again. He is not warning anyone — the
  // storm is not a hazard (§11) — he is a man watching the same weather he has
  // watched a thousand times and having an opinion about it.
  stormIn: [
    "Shamal's coming. Nothing to do about it but keep driving.",
    "Air's going brown. That's normal here, before you ask.",
    'Wind picked up. Everything you own is sand now. Sorry.',
    "You'll lose the horizon for a bit. It comes back.",
    "That's the north-westerly. Same one that built everything you're driving on.",
    'Close your windows. I know you already did. Close them again.',
  ],
  stormOut: [
    "There it goes. Cleanest air you'll get all day is right after one of those.",
    'Khalas. You can see again.',
    "Wind's dropping. Whole desert looks new when it does that.",
    'Every track out here just got erased. Including yours.',
    "Good. I was going to have to describe the view to you otherwise.",
  ],
  // Airing down and up. He has opinions about both, and the fact that he has
  // opinions is most of what teaches a new player the control matters.
  airedDown: [
    "Now you're driving properly. Should have done it at the tarmac.",
    'Fifteen. Good. The sand will stop arguing with you now.',
    "Soft tyres, soft sand. It's not complicated, but people still call me.",
    'Finally. I was going to say something.',
  ],
  airedUp: [
    'Hard tyres. Fine on the gravel, terrible everywhere else out here.',
    "Airing up already? You're not finished, habibi.",
    "Alright. Don't come crying to me at the next soft patch.",
    'Thirty-five. Very road. Very sensible. Very boring.',
  ],
  // The one genuinely instructional thing he ever says, and only when the sand
  // has already made the point for him. Never fires unless the player is
  // actually bogged at high pressure, so it reads as a man watching you make a
  // specific mistake rather than as a tutorial waiting to go off.
  pressureHint: [
    'Let some air out of those tyres. That is the whole trick, wallah.',
    "You're at road pressure in deep sand. That's why. That's the whole reason.",
    "Drop your tyres to fifteen and try that again. I'll wait.",
  ],
  signOff: [
    'Ahmed out. Try not to need me again today.',
    'Khalas. Go on then.',
    "I've got tea waiting. Drive safe, habibi.",
    "Right. I'm going back to my crossword.",
    "Ahmed out. You know where I am. Unfortunately.",
    'Yalla. Enjoy it, my friend.',
    "That's me. Shout if the sand wins.",
  ],
};
