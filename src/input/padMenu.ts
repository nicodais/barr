import { connectedPads, createPadMemory, readPad, type PadButton } from './GamepadSource';

/**
 * A controller on the screens that come before the driving.
 *
 * The landscape and vehicle pickers are up before the game loop is — the first
 * of them before the engine exists at all — so they cannot borrow the input
 * manager's polling. Without this, someone on the sofa with a pad in their
 * hands reaches a screen that only answers to a keyboard they are not holding.
 *
 * Polls on its own frame callback, and only while something is listening.
 */
export type PadMenuAction = 'confirm' | 'back' | 'prev' | 'next';

const ACTIONS: Partial<Record<PadButton, PadMenuAction>> = {
  a: 'confirm',
  menu: 'confirm',
  b: 'back',
  left: 'prev',
  up: 'prev',
  lb: 'prev',
  right: 'next',
  down: 'next',
  rb: 'next',
};

/** Starts watching. Returns the function that stops it. */
export function watchPadMenu(handler: (action: PadMenuAction) => void): () => void {
  const memory = new Map<number, ReturnType<typeof createPadMemory>>();
  const stickWas = new Map<number, number>();
  let raf = 0;
  let stopped = false;

  const tick = () => {
    if (stopped) return;
    raf = requestAnimationFrame(tick);
    for (const pad of connectedPads()) {
      let m = memory.get(pad.index);
      const first = !m;
      if (!m) {
        m = createPadMemory(pad);
        memory.set(pad.index, m);
      }
      const snap = readPad(pad, m);
      // Whatever is already down when the screen opens is not a press on this
      // screen: the A that confirmed the last one is usually still held.
      if (!first) {
        for (const name of snap.down) {
          const action = ACTIONS[name];
          if (action && !m.held.has(name)) handler(action);
        }
      }
      m.held = snap.down;

      // The left stick moves the selection too, one step per push.
      const push = Math.abs(pad.axes[0] ?? 0) > 0.6 ? Math.sign(pad.axes[0]) : 0;
      if (!first && push !== 0 && (stickWas.get(pad.index) ?? 0) === 0) {
        handler(push > 0 ? 'next' : 'prev');
      }
      stickWas.set(pad.index, push);
    }
  };
  raf = requestAnimationFrame(tick);

  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
  };
}
