/**
 * The one place the game's name and address are written down.
 *
 * Three things need them and they must never disagree: the document metadata
 * (which is what a pasted link renders as), the web-app manifest, and the mark
 * burned into saved photos. A screenshot carrying a stale URL is worse than one
 * carrying none — it sends people somewhere dead.
 *
 * `shamal` is the north-westerly that builds the dunes this game is made of. It
 * is also, deliberately, a word the region already owns: anyone from the Gulf
 * knows it without translation, and it survives a Western reading intact.
 */
export const GAME_NAME = 'Shamal';
/** Arabic wordmark, for the places that can carry both. */
export const GAME_NAME_AR = 'شمال';
export const GAME_TAGLINE = 'Dune driving in the Emirati desert';

/**
 * Absolute, because Open Graph requires it and a watermark has to be readable
 * off a photo with no context around it. Pointed at the Vercel alias until a
 * custom domain exists — changing it is this constant and nothing else.
 */
export const GAME_URL = 'https://barr-six.vercel.app';
/** What goes on the photo: no scheme, because nobody types "https://". */
export const GAME_URL_SHORT = 'barr-six.vercel.app';

export const GAME_DESCRIPTION =
  'A calm open-world drive through the dunes of Liwa and Fossil Rock. ' +
  'No timers, no damage, no way to lose — just sand, golden light, and Ahmed on the radio.';
