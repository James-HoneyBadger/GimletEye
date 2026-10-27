import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base: the bundle is embedded in the Tauri binary and loaded from
  // its own protocol, not from a web server.
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
