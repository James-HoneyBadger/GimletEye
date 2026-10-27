import { defineConfig, devices } from '@playwright/test';

/**
 * The live-engine suite: the UI driven against a real `gimlet serve`.
 *
 * `vitest` mocks the API, which means wire drift between the UI and the engine
 * is invisible to it — a renamed field or a changed status code would pass every
 * unit test and break the app. This config starts the actual binary and points a
 * real browser at it.
 *
 * The engine needs a home directory, which the spec reads to pick up the token;
 * `GIMLET_E2E_HOME` is how the two halves agree on where it is.
 */
const port = Number(process.env.GIMLET_E2E_PORT ?? 7931);
const home = process.env.GIMLET_E2E_HOME ?? '/tmp/gimlet-e2e';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // `dist` must exist: `npm run e2e` builds it first. The home is removed so
    // the server always starts from "no token", which is what the gate test
    // expects to find.
    command: `rm -rf ${home} && cargo run -q -p gimlet-eye-cli -- serve --ui-dir packages/ui/dist --port ${port}`,
    cwd: '../..',
    // The static bundle, not `/api/v1/health`: the API answers 401 without a
    // token and Playwright would never call that "ready".
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { GIMLET_HOME: home, RUST_LOG: 'warn' },
  },
});
