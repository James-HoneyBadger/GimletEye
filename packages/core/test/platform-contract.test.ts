/**
 * ADR 0006, Gate 1: "a manifest that uses `/proc` or `df` says so; those tools
 * return `unsupported` with a clear message off Linux instead of an empty
 * report."
 *
 * Written as a sweep rather than one test per tool, because the thing being
 * promised is a property of the whole catalogue: any tool that names a single
 * platform must refuse elsewhere, with the same code, before it reads anything.
 * A new tool that forgets the check fails here.
 */

import { describe, expect, it } from 'vitest';

import { defaultConfig } from '../src/config.js';
import { NODE_TOOLS } from '../src/node.js';
import { pathsUnder } from '../src/paths.js';
import type { Platform } from '../src/manifest.js';
import { fakeHost } from './fake-host.js';

const singlePlatform = NODE_TOOLS.filter((tool) => tool.manifest.platforms?.length === 1);

const ctxFor = (platform: Platform) => ({
  host: fakeHost({ platform }),
  config: defaultConfig(),
  dryRun: false,
  paths: pathsUnder('/home/tester/.gimlet'),
});

/** Required arguments named after what they are, so a tool that checks its
 * arguments first still gets past them. */
const argsFor = (tool: (typeof NODE_TOOLS)[number]): Record<string, string> =>
  Object.fromEntries(
    (tool.manifest.args ?? []).filter((arg) => arg.required).map((arg) => [arg.name, `/home/tester/${arg.name}`]),
  );

describe('the platform contract', () => {
  it('has tools that name one platform, or this test proves nothing', () => {
    expect(singlePlatform.length).toBeGreaterThan(0);
  });

  for (const tool of singlePlatform) {
    const only = tool.manifest.platforms?.[0] as Platform;
    const elsewhere = (['linux', 'macos', 'windows'] as const).filter((platform) => platform !== only);

    for (const platform of elsewhere) {
      it(`${tool.manifest.id} says 'unsupported' on ${platform}, not an empty report`, async () => {
        const failure = await tool.run(ctxFor(platform), argsFor(tool)).catch((error: unknown) => error as {
          code?: string;
          message: string;
        });

        expect(failure).toMatchObject({ code: 'unsupported' });
        // The message names the platform the tool does target, so the reader
        // knows whether to look elsewhere or stop.
        expect(failure.message).toMatch(/Linux|macOS/);
      });
    }
  }
});
