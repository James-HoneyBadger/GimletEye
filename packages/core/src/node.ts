/**
 * The Node entry point: the runtime with every tool this build can run.
 *
 * Kept out of the main barrel because these tools are built on `node:crypto`,
 * and the barrel is bundled into the desktop webview. The desktop gets the same
 * tools from the engine over the sidecar instead.
 */

import { metadataScan, metadataVerify } from './tools/metadata.js';
import { SIGNING_TOOLS } from './tools/signatures.js';
import { sha256 } from './tools/hash.js';
import { passgen } from './tools/passwords.js';
import { HOST_TOOLS } from './runtime.js';

export * from './runtime.js';

/** Every tool the Node build registers before it asks the engine for the rest. */
export const NODE_TOOLS = [...HOST_TOOLS, sha256, passgen, metadataScan, metadataVerify, ...SIGNING_TOOLS];
