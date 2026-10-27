import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The desktop config is checked by reading it, because the failures it can have
 * are silent: a capability scoped to a window that does not exist denies every
 * IPC call at run time, and a missing `externalBin` is only noticed when the
 * bundle is built. `cargo check` catches neither.
 */
const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

const config = JSON.parse(readFileSync(here('../src-tauri/tauri.conf.json'), 'utf8'));
const capability = JSON.parse(readFileSync(here('../src-tauri/capabilities/default.json'), 'utf8'));

describe('tauri configuration', () => {
  it('declares a window for every capability that names one', () => {
    const labels = (config.app.windows ?? []).map((window: { label: string }) => window.label);
    expect(labels).toContain('main');
    for (const label of capability.windows ?? []) {
      expect(labels).toContain(label);
    }
  });

  it('bundles the engine the frontend talks to', () => {
    expect(config.bundle.externalBin).toContain('binaries/gimlet-sidecar');
  });

  it('serves the bundle from the build, not from a web server', () => {
    expect(config.build.frontendDist).toBe('../dist');
    expect(config.build.devUrl).toContain('localhost');
    // No HTTP origin is allowed to drive the app: only Tauri's own IPC.
    expect(config.app.security.csp).toContain('ipc:');
    expect(config.app.security.csp).not.toContain('http://127.0.0.1');
  });

  it('keeps the identifier reverse-DNS and away from the old name', () => {
    expect(config.identifier).toMatch(/^[a-z]+\.[a-z0-9.]*[a-z0-9]$/);
    expect(config.identifier).not.toContain('mellivora');
  });
});
