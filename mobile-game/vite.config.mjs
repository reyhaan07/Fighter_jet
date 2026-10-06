import { defineConfig } from 'vite';

// Builds the same game (../index.html + ../src) for the Android app.
// Run from the repo root: npx vite build --config mobile-game/vite.config.mjs
export default defineConfig({
  root: '.',
  base: './',
  build: {
    outDir: 'mobile-game/www',
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    assetsInlineLimit: 0,
  },
  worker: { format: 'es' },
});
