import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/desktop/src/**/*.test.ts'],
    environment: 'node',
    // jsdom has no matchMedia, and the UI store reads it as it evaluates.
    setupFiles: ['apps/desktop/src/test-setup.ts'],
    reporters: 'default',
  },
});
