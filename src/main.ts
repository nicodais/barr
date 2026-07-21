import './style.css';
import { Game } from './engine/Game';

const canvas = document.getElementById('viewport') as HTMLCanvasElement | null;
const uiRoot = document.getElementById('ui') as HTMLElement | null;
const loader = document.getElementById('loader');

if (!canvas || !uiRoot) {
  throw new Error('Missing #viewport or #ui in the document');
}

Game.create(canvas, uiRoot)
  .then((game) => {
    loader?.remove();
    game.start();
    // Dev handle for poking at physics state from the console while tuning.
    if (import.meta.env.DEV) {
      (globalThis as Record<string, unknown>).dune = game;
    }
  })
  .catch((err) => {
    console.error(err);
    if (loader) {
      loader.textContent = 'Could not start — this browser may not support WebGL.';
      loader.classList.add('loader-error');
    }
  });
