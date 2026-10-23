import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the same bundle works from the Tauri shell, the local
  // HTTP server, and any static host.
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
