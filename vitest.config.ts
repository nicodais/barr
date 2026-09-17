import { defineConfig } from 'vitest/config';

/**
 * Kept separate from `vite.config.ts` so the app build never carries the test
 * config, and so the manual vendor chunking there can't affect how tests
 * resolve `three` or Rapier.
 *
 * Everything under `tests/` runs in plain Node: the suites cover the pure
 * layers — data, persistence, terrain maths — which is the whole reason they
 * are cheap enough to run on every push. Nothing here needs jsdom, WebGL or a
 * browser, and if a test ever does, that is the signal it is testing the wrong
 * thing (see docs/TESTING.md §4, "Explicitly not worth testing").
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
