import { defineConfig } from 'vite';

/**
 * Sourcemaps: on for the web, off for the native bundle.
 *
 * They are ~6MB of `.map` files, which on Vercel cost nothing (nobody fetches
 * them unless devtools is open) and are genuinely useful for debugging a
 * production URL. Inside an IPA they are dead weight the user downloads and
 * stores, since there is no devtools to open. `npm run build:native` sets this.
 */
const sourcemap = process.env.SHAMAL_NATIVE !== '1';

export default defineConfig({
  server: { host: true },
  build: {
    target: 'es2022',
    sourcemap,
    rollupOptions: {
      output: {
        // Three and Rapier are large and change only when their versions do.
        // Splitting them means a code change re-downloads a small app chunk
        // instead of ~900 kB of vendor code on every deploy.
        manualChunks: {
          three: ['three'],
          rapier: ['@dimforge/rapier3d-compat'],
        },
      },
    },
  },
  // Rapier ships a WASM blob; the -compat build inlines it, so no special
  // plugin is needed — but keep it out of dep pre-bundling churn.
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d-compat'],
  },
});
