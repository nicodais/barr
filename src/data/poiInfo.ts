import { POI_PHOTOS } from './poiPhotos';
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
  /** Path under /public, e.g. "/photos/falaj-commons.jpg"; omit to show text only. */
  photo?: string;
  /** Attribution line for the photo, shown small on the card. */
  credit?: string;
  photoAlt?: string;
  source?: string;
  license?: string;
  licenseUrl?: string;
}

export const POI_INFO: Record<PoiKind, PoiInfo> = {
  falaj: {
    ...POI_PHOTOS.falaj,
    title: 'The Falaj',
    body:
      'For over 3,000 years, hand-dug falaj channels carried mountain water to date ' +
      'gardens across the Emirates — engineering that made desert settlement possible. ' +
      'The aflaj of Al Ain\'s oases are UNESCO-listed and some still run today.',
  },
  ghaf: {
    ...POI_PHOTOS.ghaf,
    title: 'The Ghaf Tree',
    body:
      'The ghaf is the UAE\'s national tree: its roots reach tens of metres down, and ' +
      'Bedouin life leaned on its shade, pods and firewood. Sheikh Zayed planted millions ' +
      'in his greening campaigns, and the tree is now a protected symbol of tolerance.',
  },
  watchtower: {
    ...POI_PHOTOS.watchtower,
    title: 'The Watchtower',
    body:
      'Stone and mudbrick watchtowers once guarded oases, wells and caravan routes across ' +
      'the Emirates. Many are lovingly restored today — landmarks of a time when water ' +
      'and trade routes were worth watching over.',
  },
  majlis: {
    ...POI_PHOTOS.majlis,
    title: 'The Majlis',
    body:
      'The majlis — "a place of sitting" — is where rulers and families receive guests, ' +
      'settle matters and share news. UNESCO lists it as intangible cultural heritage, ' +
      'and open majlis councils remain a living institution in the UAE today.',
  },
  oilwell: {
    ...POI_PHOTOS.oilwell,
    title: 'The Oil Surveys',
    body:
      'Mid-century crews mapped these deserts stake by stake, then put a derrick on ' +
      'anything that looked promising. The first exports left Abu Dhabi in 1962 and ' +
      'transformed the Emirates within a generation — but most wildcat wells found ' +
      'nothing, and were plugged, capped and abandoned where they stood.',
  },
  pylons: {
    ...POI_PHOTOS.pylons,
    title: 'The Transmission Line',
    body:
      'Power reached the inland villages decades after the coast, and the lines were ' +
      'run straight across open sand because there was nothing to route around. ' +
      'Crews still grade the access tracks clear each season — the dunes here move ' +
      'far enough in a year to bury one.',
  },
  teastand: {
    ...POI_PHOTOS.teastand,
    title: 'The Karak Stop',
    body:
      'Karak chai — strong tea boiled with milk, cardamom and sugar — arrived with South ' +
      'Asian communities and became an Emirati everyday ritual. Roadside cafeterias and ' +
      'tiny tea stands are where half the country pauses, talks and refuels.',
  },
  famousdune: {
    ...POI_PHOTOS.famousdune,
    title: 'Tal Moreeb',
    body:
      'Dune bashing grew from desert know-how into one of the UAE\'s signature ' +
      'experiences, and certain photogenic dunes — like Moreeb Dune in Liwa — have become ' +
      'destinations in their own right for festivals, hill climbs and a million photos.',
  },
  falconry: {
    ...POI_PHOTOS.falconry,
    title: 'Falconry — Al Qannas',
    body:
      'Falconry fed Bedouin families long before it became sport, and Sheikh Zayed ' +
      'championed it as living heritage. UNESCO-listed, it thrives today — the UAE issues ' +
      'falcon passports and runs the world\'s largest falcon hospital.',
  },
  cameltrack: {
    ...POI_PHOTOS.cameltrack,
    title: 'Camel Racing',
    body:
      'Camels carried Bedouin life — milk, transport, wealth, poetry — and racing them is ' +
      'a heritage sport the Emirates still celebrates at purpose-built tracks, where ' +
      'robot jockeys have replaced child riders and bloodlines are prized like royalty.',
  },
  fossilbed: {
    ...POI_PHOTOS.fossilbed,
    title: 'Fossil Rock',
    body:
      'Jebel Maleihah is a slab of Cretaceous seabed tilted out of the desert — the ' +
      'shells and sea urchins in it are around 65 million years old. The dunes ' +
      'banked against its western flank are one of the best-known 4x4 runs in the ' +
      'Emirates.',
  },
  tomb: {
    ...POI_PHOTOS.tomb,
    title: 'Umm an-Nar Tombs',
    body:
      'Mleiha holds one of the richest archaeological records in the Gulf: circular ' +
      'Umm an-Nar communal tombs from around 2000 BC, an Iron Age settlement, and a ' +
      'pre-Islamic fort. The same water that made the desert liveable made it worth ' +
      'burying your family here.',
  },
  oasis: {
    ...POI_PHOTOS.oasis,
    title: 'The Liwa Oases',
    body:
      'Liwa is a 100km crescent of date-palm oases along the northern edge of the Empty ' +
      'Quarter — the ancestral home of the Bani Yas, and of the family that founded the ' +
      'UAE. Dates were food, trade and survival, and the summer harvest still empties ' +
      'Abu Dhabi into the desert every July.',
  },
  coffeehearth: {
    ...POI_PHOTOS.coffeehearth,
    title: 'Gahwa — Arabic Coffee',
    body:
      'Gahwa, lightly roasted and spiced with cardamom, is the heart of Emirati ' +
      'hospitality: served from the long-spouted dallah to every guest, ruler or ' +
      'stranger. The ritual is UNESCO-listed and opens gatherings to this day.',
  },
};
