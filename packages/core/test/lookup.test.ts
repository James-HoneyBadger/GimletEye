import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { sidecarPath } from '../src/host-node.js';

describe('finding the engine', () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = undefined;
  });

  it('prefers the new sidecar override but accepts the legacy variable', () => {
    expect(sidecarPath({ env: { GIMLET_SIDECAR: '/opt/engine/gimlet-sidecar' } })).toBe('/opt/engine/gimlet-sidecar');
    expect(
      sidecarPath({ env: { GIMLET_WORKS_SIDECAR: '/opt/new', GIMLET_SIDECAR: '/opt/old' } }),
    ).toBe('/opt/new');
    expect(sidecarPath({ env: { GIMLET_WORKS_SIDECAR: '', GIMLET_SIDECAR: '/opt/old' } })).toBe('/opt/old');
  });

  it('finds the legacy name on PATH when no new sidecar is installed', async () => {
    root = await mkdtemp(join(tmpdir(), 'gimlet-sidecar-path-'));
    const engine = join(root, 'gimlet-sidecar');
    await writeFile(engine, '', { mode: 0o755 });
    const moduleDir = join(root, 'installed', 'core', 'dist');
    await mkdir(moduleDir, { recursive: true });
    expect(
      sidecarPath({
        moduleUrl: pathToFileURL(join(moduleDir, 'host-node.js')).href,
        execPath: join(root, 'bin', 'node'),
        env: { PATH: root },
      }),
    ).toBe(engine);
  });

  it.skipIf(process.platform === 'win32')('ignores a non-executable new PATH candidate', async () => {
    root = await mkdtemp(join(tmpdir(), 'gimlet-sidecar-path-'));
    await writeFile(join(root, 'gimlet-works-sidecar'), '', { mode: 0o644 });
    const legacy = join(root, 'gimlet-sidecar');
    await writeFile(legacy, '', { mode: 0o755 });
    expect(
      sidecarPath({
        moduleUrl: pathToFileURL(join(root, 'installed', 'core', 'dist', 'host-node.js')).href,
        execPath: join(root, 'bin', 'node'),
        env: { PATH: root },
      }),
    ).toBe(legacy);
  });

  it('finds the engine from the install layout, not from node', async () => {
    // The layout a package creates: the CLI runs as /usr/bin/node on a module
    // two directories below the engine, so `process.execPath` is no help.
    root = await mkdtemp(join(tmpdir(), 'gimlet-install-'));
    const engine = join(root, 'gimlet-sidecar');
    await writeFile(engine, '');
    const moduleDir = join(root, 'core', 'dist');
    await mkdir(moduleDir, { recursive: true });
    const moduleFile = join(moduleDir, 'host-node.js');
    await writeFile(moduleFile, '');

    expect(
      sidecarPath({
        moduleUrl: pathToFileURL(moduleFile).href,
        execPath: '/usr/bin/node',
        env: { PATH: join(root, 'empty-path') },
      }),
    ).toBe(engine);
  });

  it('falls back to PATH by name when nothing is installed', async () => {
    root = await mkdtemp(join(tmpdir(), 'gimlet-empty-'));
    const moduleFile = join(root, 'core', 'dist', 'host-node.js');
    await mkdir(join(root, 'core', 'dist'), { recursive: true });
    await writeFile(moduleFile, '');

    const found = sidecarPath({
      moduleUrl: pathToFileURL(moduleFile).href,
      execPath: join(root, 'node'),
      env: { PATH: join(root, 'empty-path') },
    });
    expect(found).toBe('gimlet-works-sidecar');
  });
});
