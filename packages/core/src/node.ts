/**
 * The Node entry point: the runtime with every tool this build can run.
 *
 * Kept out of the main barrel because these tools are built on `node:crypto`,
 * and the barrel is bundled into the desktop webview. The desktop gets the same
 * tools from the engine over the sidecar instead.
 */

import { configDrift } from './tools/config-drift.js';
import { CONTAINER_TOOLS } from './tools/containers.js';
import { GPG_TOOLS } from './tools/gpg.js';
import { INSPECT_TOOLS } from './tools/keys.js';
import { KEYSTORE_TOOLS } from './tools/keystore-tools.js';
import { metadataScan, metadataStrip, metadataVerify } from './tools/metadata.js';
import { SIGNING_TOOLS } from './tools/signatures.js';
import { sha256 } from './tools/hash.js';
import { passAudit } from './tools/pass-audit.js';
import { passgen } from './tools/passwords.js';
import { HOST_TOOLS } from './runtime.js';
import type { LocalTool } from './local.js';

export * from './runtime.js';

/**
 * Every tool the Node build registers before it asks the engine for the rest.
 *
 * A local tool's manifest *replaces* the engine's for the same id, so a tool
 * that is implemented here but missing from this list is not merely slower: it
 * silently runs the old implementation. `node-tools.test.ts` holds the two
 * lists together.
 */
export const NODE_TOOLS: readonly LocalTool[] = [
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
