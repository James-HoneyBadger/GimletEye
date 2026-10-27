import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const at = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    // Tests run against the source, not the build: `npm test` on a fresh
    // checkout must not depend on someone having run `npm run build` first.
    // The more specific entry point comes first.
    alias: [
      { find: '@gimlet-eye/core/host-node', replacement: at('./packages/core/src/host-node.ts') },
      { find: '@gimlet-eye/core', replacement: at('./packages/core/src/index.ts') },
    ],
  },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/desktop/src/**/*.test.ts', 'apps/desktop/electron/**/*.test.ts'],
    environment: 'node',
    // jsdom has no matchMedia, and the UI store reads it as it evaluates.
    setupFiles: ['apps/desktop/src/test-setup.ts'],
    reporters: 'default',
  },
});
