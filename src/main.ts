import './style.css';
import { MapSelect } from './ui/MapSelect';
import { loadSettings, saveSettings } from './settings/Settings';

/**
 * Boot order, and why it is this way round.
 *
 * The engine is 2MB of Rapier WASM plus half a megabyte of three, and none of
 * it is needed to ask someone which desert they want. So the map picker goes up
 * first, on its own — it is DOM and CSS and a table of two region names — and
 * the engine downloads behind it. The first interactive moment becomes a choice
 * instead of a progress message, and the download gets however long the player
 * spends reading two cards for free.
 *
 * The pick has to land *before* the Game is constructed, not after: the region
 * decides what the height field is, so choosing it first means the world is
 * built once, in the right place, rather than built and then torn down.
 *
 * `import('./engine/Game')` is a dynamic import on purpose. A static one would
 * put the whole engine back in the initial module graph and undo all of this —
 * Vite would preload the chunk before the first paint.
 */

const canvas = document.getElementById('viewport') as HTMLCanvasElement | null;
const uiRoot = document.getElementById('ui') as HTMLElement | null;
const loader = document.getElementById('loader');

if (!canvas || !uiRoot) {
  throw new Error('Missing #viewport or #ui in the document');
}

void boot(canvas, uiRoot);

async function boot(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
  const settings = loadSettings();

  // Started before the picker is even on screen, and deliberately not awaited
  // yet: this is the download we are hiding behind the choice. The flag is an
  // explicit "has it landed" rather than a race against a resolved promise,
  // whose outcome would turn on microtask ordering through the catch.
  let ready = false;
  let failure: unknown = null;
  const engine = import('./engine/Game')
    .then((mod) => { ready = true; return mod; })
    .catch((err) => { failure = err; return null; });

  const mapSelect = new MapSelect(settings.region);
  uiRoot.appendChild(mapSelect.element);
  const picked = mapSelect.open();
  // The picker replaces the loader rather than sitting behind it.
  loader?.remove();

  const region = await picked;
  // Persisted before the Game is built, because its constructor reads the
  // region back out of settings — that is the one path into the height field.
  settings.region = region;
  saveSettings(settings);

  // Only say we're loading if we actually are. On a warm cache the module is
  // already here and the panel goes straight out.
  if (!ready) mapSelect.waiting('Warming the sand…');

  const mod = await engine;
  if (!mod) return fail(failure);

  let game;
  try {
    game = await mod.Game.create(canvas, uiRoot);
  } catch (err) {
    return fail(err);
  }

  mapSelect.close();
  game.start();
  // The truck picker follows, over a world that is now live and lit — so the
  // car being chosen is the actual car, on the actual sand.
  void game.chooseCar();
  if (import.meta.env.DEV) {
    (globalThis as Record<string, unknown>).dune = game;
  }
}

function fail(err: unknown) {
  console.error(err);
  // The loader is gone by now, so the message goes where the player is looking.
  const notice = document.createElement('div');
  notice.id = 'loader';
  notice.className = 'loader-error';
  notice.textContent = 'Could not start — this browser may not support WebGL.';
  document.body.appendChild(notice);
}
