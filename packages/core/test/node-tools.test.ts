/**
 * The registration guard.
 *
 * A port is not done when its tests pass: the tool also has to be *listed*, or
 * the runtime keeps calling the engine for it and the new implementation is
 * dead code. That happened — four ports landed with their manifests imported
 * and never registered — so this test pins the list to the modules.
 */

import { describe, expect, it } from 'vitest';

import { NODE_TOOLS } from '../src/node.js';
import { HOST_TOOLS } from '../src/runtime.js';
import { configDrift } from '../src/tools/config-drift.js';
import { CONTAINER_TOOLS } from '../src/tools/containers.js';
import { GPG_TOOLS } from '../src/tools/gpg.js';
import { sha256 } from '../src/tools/hash.js';
import { INSPECT_TOOLS } from '../src/tools/keys.js';
import { KEYSTORE_TOOLS } from '../src/tools/keystore-tools.js';
import { metadataScan, metadataStrip, metadataVerify } from '../src/tools/metadata.js';
import { passAudit } from '../src/tools/pass-audit.js';
import { passgen } from '../src/tools/passwords.js';
import { SIGNING_TOOLS } from '../src/tools/signatures.js';
import type { LocalTool } from '../src/local.js';

const IMPLEMENTED: readonly LocalTool[] = [
  ...HOST_TOOLS,
  sha256,
  passgen,
  metadataScan,
  metadataVerify,
  metadataStrip,
  ...SIGNING_TOOLS,
  ...CONTAINER_TOOLS,
  ...INSPECT_TOOLS,
  ...KEYSTORE_TOOLS,
  ...GPG_TOOLS,
  configDrift,
  passAudit,
];

describe('the Node tool list', () => {
  it('registers every tool implemented here', () => {
    const registered = new Set(NODE_TOOLS.map((tool) => tool.manifest.id));
    const missing = IMPLEMENTED.map((tool) => tool.manifest.id).filter((id) => !registered.has(id));
    expect(missing).toEqual([]);
  });

  it('registers each id once', () => {
    const ids = NODE_TOOLS.map((tool) => tool.manifest.id);
    expect(ids).toEqual([...new Set(ids)]);
  });

  it('agrees with the modules about how many tools that is', () => {
    expect(NODE_TOOLS.length).toBe(IMPLEMENTED.length);
  });
});
