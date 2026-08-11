import type { PoiKind } from './pois';

/**
 * The arrival card for each POI (§5): what this place is in the real UAE, why
 * it matters to the culture, and what it means today. Shown while the player
 * is inside the POI radius, gone when they drive off — informational texture,
 * never a gate. Photos are freely-licensed images served from /public/photos
 * with the credit shown on the card.
 */
export interface PoiInfo {
  title: string;
  body: string;
  /** Path under /public, e.g. "/photos/falaj.jpg"; omit to show text only. */
  photo?: string;
  /** Attribution line for the photo, shown small on the card. */
  credit?: string;
}

export const POI_INFO: Record<PoiKind, PoiInfo> = {
  falaj: {
    title: 'The Falaj',
    body:
      'For over 3,000 years, hand-dug falaj channels carried mountain water to date ' +
      'gardens across the Emirates — engineering that made desert settlement possible. ' +
      'The aflaj of Al Ain\'s oases are UNESCO-listed and some still run today.',
    photo: '/photos/falaj.jpg',
    credit: 'https://www.greenprophet.com/2020/10/the-uae-and-omans-3000-year-old-irrigation-system/'
  },
  ghaf: {
    title: 'The Ghaf Tree',
    body:
      'The ghaf is the UAE\'s national tree: its roots reach tens of metres down, and ' +
      'Bedouin life leaned on its shade, pods and firewood. Sheikh Zayed planted millions ' +
      'in his greening campaigns, and the tree is now a protected symbol of tolerance.',
    photo: '/photos/ghaf.jpg',
    credit: 'https://www.happydesertsafari.com/blog/ghaf-tree-uae/'
  },
  watchtower: {
    title: 'The Watchtower',
    body:
      'Stone and mudbrick watchtowers once guarded oases, wells and caravan routes across ' +
      'the Emirates. Many are lovingly restored today — landmarks of a time when water ' +
      'and trade routes were worth watching over.',
    photo: '/photos/watchtower.jpg',
    credit: 'https://www.flickr.com/photos/ryanechevarria/41194012651'
  },
  majlis: {
    title: 'The Majlis',
    body:
      'The majlis — "a place of sitting" — is where rulers and families receive guests, ' +
      'settle matters and share news. UNESCO lists it as intangible cultural heritage, ' +
      'and open majlis councils remain a living institution in the UAE today.',
    photo: '/photos/majlis.jpg',
    credit: 'https://www.desertsafarisdubai.com/desert-safari-with-vip-majlis-tent/'
  },
  pylons: {
    title: 'The Oil Surveys',
    body:
      'Mid-century oil exploration crews mapped these deserts stake by stake. The first ' +
      'exports left Abu Dhabi in 1962 and transformed the Emirates within a generation — ' +
      'though plenty of surveyed patches, like this one, gave nothing back.',
    photo: '/photos/pylons.jpg',
    credit: 'https://emiratitimes.com/a-brief-history-of-oil-in-the-united-arab-emirates/'
  },
  teastand: {
    title: 'The Karak Stop',
    body:
      'Karak chai — strong tea boiled with milk, cardamom and sugar — arrived with South ' +
      'Asian communities and became an Emirati everyday ritual. Roadside cafeterias and ' +
      'tiny tea stands are where half the country pauses, talks and refuels.',
    photo: '/photos/teastand.jpg',
    credit: 'https://gulfnews.com/uae/the-bitter-truth-about-your-sweet-karak-tea-in-uae-1.68663205'
  },
  famousdune: {
    title: 'Tal Moreeb',
    body:
      'Dune bashing grew from desert know-how into one of the UAE\'s signature ' +
      'experiences, and certain photogenic dunes — like Moreeb Dune in Liwa — have become ' +
      'destinations in their own right for festivals, hill climbs and a million photos.',
    photo: '/photos/famousdune.jpg',
    credit: 'https://www.flickr.com/photos/jakelley/34943971041'
  },
  falconry: {
    title: 'Falconry — Al Qannas',
    body:
      'Falconry fed Bedouin families long before it became sport, and Sheikh Zayed ' +
      'championed it as living heritage. UNESCO-listed, it thrives today — the UAE issues ' +
      'falcon passports and runs the world\'s largest falcon hospital.',
    photo: '/photos/falconry.jpg',
    credit: 'https://www.thenationalnews.com/uae/heritage/2022/10/17/uae-rulers-long-history-with-falconry-in-pictures/'
  },
  cameltrack: {
    title: 'Camel Racing',
    body:
      'Camels carried Bedouin life — milk, transport, wealth, poetry — and racing them is ' +
      'a heritage sport the Emirates still celebrates at purpose-built tracks, where ' +
      'robot jockeys have replaced child riders and bloodlines are prized like royalty.',
    photo: '/photos/cameltrack.jpg',
    credit: 'https://www.usatoday.com/picture-gallery/tech/2017/01/03/centuries-old-tradition-changed-by-technology/96116762/'
  },
  oasis: {
    title: 'The Liwa Oases',
    body:
      'Liwa is a 100km crescent of date-palm oases along the northern edge of the Empty ' +
      'Quarter — the ancestral home of the Bani Yas, and of the family that founded the ' +
      'UAE. Dates were food, trade and survival, and the summer harvest still empties ' +
      'Abu Dhabi into the desert every July.',
  },
  coffeehearth: {
    title: 'Gahwa — Arabic Coffee',
    body:
      'Gahwa, lightly roasted and spiced with cardamom, is the heart of Emirati ' +
      'hospitality: served from the long-spouted dallah to every guest, ruler or ' +
      'stranger. The ritual is UNESCO-listed and opens gatherings to this day.',
    photo: '/photos/coffeehearth.jpg',
    credit: 'https://www.thenationalnews.com/arts-culture/2025/05/12/coffee-ceremony-arabic-gulf-gahwa-brewing-tradition/'
  },
};
