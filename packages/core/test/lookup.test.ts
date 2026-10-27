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

  it('uses GIMLET_SIDECAR above everything else', () => {
    expect(sidecarPath({ env: { GIMLET_SIDECAR: '/opt/engine/gimlet-sidecar' } })).toBe('/opt/engine/gimlet-sidecar');
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
        env: {},
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
      env: {},
    });
    expect(found).toBe('gimlet-sidecar');
  });
});
