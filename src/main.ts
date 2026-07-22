import './style.css';
import { Game } from './engine/Game';

const canvas = document.getElementById('viewport') as HTMLCanvasElement | null;
const uiRoot = document.getElementById('ui') as HTMLElement | null;
const loader = document.getElementById('loader');
const splash = document.getElementById('splash');

if (!canvas || !uiRoot) {
  throw new Error('Missing #viewport or #ui in the document');
}

/**
 * The title fades in over 3s (CSS); hold it a breath, then fade the splash
 * away — but never before the game is actually ready underneath it. A slow
 * load simply extends the hold: the splash doubles as the loading screen.
 */
const SPLASH_MIN_MS = 4800;
const splashShownAt = performance.now();

function dismissSplash() {
  if (!splash) return;
  const remaining = Math.max(0, SPLASH_MIN_MS - (performance.now() - splashShownAt));
  window.setTimeout(() => {
    splash.classList.add('splash-out');
    // Removed after the 1s opacity transition; the timer is the safety net in
    // case transitionend never fires (backgrounded tab).
    window.setTimeout(() => splash.remove(), 1400);
  }, remaining);
}

Game.create(canvas, uiRoot)
  .then((game) => {
    loader?.remove();
    game.start();
    dismissSplash();
    // Dev handle for poking at physics state from the console while tuning.
    if (import.meta.env.DEV) {
      (globalThis as Record<string, unknown>).barr = game;
    }
  })
  .catch((err) => {
    console.error(err);
    // The error must not stay hidden behind the title card.
    splash?.remove();
    if (loader) {
      loader.textContent = 'Could not start — this browser may not support WebGL.';
      loader.classList.add('loader-error');
    }
  });
