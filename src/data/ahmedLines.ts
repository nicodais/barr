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
import type { BodyId } from '../vehicle/vehicleConfig';
import type { RegionId } from '../terrain/regions';

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
  | 'nightfall'
  | 'dawn'
  | 'midday'
  | 'dusk'
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
  // The day turning over. These only exist because the 20-minute cycle is now
  // running by default — a frozen sky gave him nothing to notice. Each band is
  // about what the light does to the *driving*, not about the view, because he
  // is a man on a radio and not a travel programme.
  nightfall: [
    "Dark now. Out here that means properly dark. Watch the crests.",
    "Night driving. Everything looks flat and none of it is.",
    'This is the hour people call me. Every single time.',
    'Headlights on a dune face tell you nothing. Go slow, habibi.',
  ],
  dawn: [
    "Best hour of the day and nobody is ever awake for it.",
    "Sun's up. The air is the cleanest it will be until tomorrow.",
    'Dawn. Even the sand looks like it got some sleep.',
    "Early. Good. You'll have the whole desert to yourself for an hour.",
  ],
  midday: [
    'Midday. Even the camels have found shade. You have not.',
    "It's hot out there. I'm inside. Just so we understand each other.",
    'Nothing has a shadow right now, which makes a dune very hard to read.',
    'High sun. Everything goes flat and white and you drive off a crest you never saw.',
  ],
  dusk: [
    'Golden hour. Every photo ever taken out here was taken in the next twenty minutes.',
    "Sun's going. Long shadows — the crests get honest about how steep they are.",
    'That light. Wallah. Even I look up for that one.',
    "Careful now. Low sun straight in the eyes is how people find the one rock out here.",
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

/**
 * What he thinks of what you're driving.
 *
 * Keyed by body rather than drawn from one pool, because a line that could be
 * about any vehicle is exactly the generic filler §13's tone guardrails rule
 * out — the joke has to be about *that* truck. Three each: one on the first
 * ambient slot after sign-on, and one whenever you change in the garage, so a
 * player who tries several never hears the same remark twice.
 */
export const AHMED_VEHICLE_LINES: Record<BodyId, string[]> = {
  wagon: [
    "A safari wagon. Sensible. Boring, but sensible.",
    'Half the people I recover are driving one of those. The other half wish they were.',
    "Old wagon. It'll go anywhere you point it. Eventually.",
  ],
  pickup: [
    'That thing weighs more than my station.',
    "A pickup with an empty bed. You're not fooling anyone, habibi.",
    'Big truck. Big engine. Big hole, when it finally stops.',
  ],
  gwagon: [
    'The square one. Very expensive way to get sand in everything you own.',
    "Nice box. It'll climb anything, and roll doing it.",
    "Third one of those I've seen this month. All the same colour as yours.",
  ],
  singlecab: [
    'A work truck. Someone out here has actually done this before.',
    'Single cab. No comfort, no speed, goes forever.',
    "That's a farm truck, my friend. It will out-climb everyone and out-run nobody.",
  ],
  softtop: [
    'No roof. Bold, at this hour.',
    "Soft top. So when you roll it, you'll really feel involved.",
    "Open air. Enjoy the sand — you'll be eating it either way.",
  ],
  moto: [
    "A bike. In the dunes. Wallah, I'm keeping this radio close.",
    "Two wheels. That is half the usual number, habibi.",
    "Fine. But when I write the report I am not explaining the bike.",
  ],
  buggy: [
    'A buggy. So you came out here to actually enjoy yourself. I see.',
    'That thing floats over sand that swallows trucks. Try not to look so pleased.',
    'No doors, no roof, no sense. Perfect.',
  ],
};

/** Where you are. Fires on arrival and on a region change. */
export const AHMED_REGION_LINES: Record<RegionId, string[]> = {
  liwa: [
    "Sand in every direction and nothing else. That's Liwa. That's the whole report.",
    'Out here the only thing to hit is the ground, and you have to work at it.',
    'Deep sand country. Whatever pressure you are on, it is probably too high.',
  ],
  fossilrock: [
    'Careful here. That rock was a seabed once and it has not softened since.',
    'Harder ground, tighter lines. You can actually carry speed out here — so people do.',
    'Red sand up against limestone. Very pretty. Very unforgiving on a rim.',
  ],
};
