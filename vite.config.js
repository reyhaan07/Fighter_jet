import { defineConfig } from 'vite';

// Relative base so the built game also runs from file:// inside Tauri/Electron.
export default defineConfig({
  base: './',
  server: { port: 5173, host: '127.0.0.1' },
  preview: { port: 4173, host: '127.0.0.1' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    assetsInlineLimit: 0,
  },
  worker: { format: 'es' },
});
