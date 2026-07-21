import { defineConfig } from 'vite';

export default defineConfig({
  server: { host: true },
  build: {
    target: 'es2022',
    sourcemap: true,
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
