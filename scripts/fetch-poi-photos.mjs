#!/usr/bin/env node
/**
 * Fetches freely-licensed real-world photos for the POI arrival cards.
 *
 * Run LOCALLY (needs open network; the cloud dev environment blocks image
 * hosts): `node scripts/fetch-poi-photos.mjs`
 *
 * Uses the Openverse API (openverse.org — CC-licensed media search, no API
 * key). Downloads the best CC0/CC-BY/CC-BY-SA hit per POI to
 * public/photos/{id}.jpg and prints the credit lines to paste into
 * src/data/poiInfo.ts (set `photo: '/photos/{id}.jpg'` and `credit`).
 * Review each image before shipping — search relevance varies.
 */
import { writeFileSync, mkdirSync } from 'fs';

const QUERIES = {
  falaj: 'falaj irrigation oasis al ain',
  ghaf: 'prosopis cineraria ghaf tree desert',
  watchtower: 'watchtower fort al ain oasis',
  majlis: 'majlis arabic seating interior',
  pylons: 'oil exploration desert derrick historic',
  teastand: 'karak chai tea glass',
  famousdune: 'liwa desert dune',
  falconry: 'falconry falcon arab glove',
  cameltrack: 'camel racing track uae',
  coffeehearth: 'dallah arabic coffee pot',
};

const LICENSES = 'cc0,by,by-sa';
mkdirSync('public/photos', { recursive: true });
const credits = {};

for (const [id, q] of Object.entries(QUERIES)) {
  const url =
    `https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}` +
    `&license=${LICENSES}&size=medium&page_size=5`;
  const res = await fetch(url, { headers: { 'User-Agent': 'dune-poi-photos/1.0' } });
  if (!res.ok) { console.error(`${id}: search failed (${res.status})`); continue; }
  const data = await res.json();
  const hit = data.results?.[0];
  if (!hit) { console.error(`${id}: no results`); continue; }

  const img = await fetch(hit.url, { headers: { 'User-Agent': 'dune-poi-photos/1.0' } });
  if (!img.ok) { console.error(`${id}: download failed (${img.status})`); continue; }
  writeFileSync(`public/photos/${id}.jpg`, Buffer.from(await img.arrayBuffer()));

  const license = hit.license.toUpperCase() === 'CC0' ? 'CC0' : `CC ${hit.license.toUpperCase()} ${hit.license_version}`;
  credits[id] = `Photo: ${hit.creator ?? 'unknown'}, ${license}, via Openverse`;
  console.log(`${id}: saved (${hit.title ?? 'untitled'} — ${credits[id]})`);
}

console.log('\nPaste into src/data/poiInfo.ts (and switch photo paths to .jpg):\n');
for (const [id, credit] of Object.entries(credits)) {
  console.log(`  ${id}: credit: ${JSON.stringify(credit)},`);
}
