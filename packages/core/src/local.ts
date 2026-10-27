/**
 * A tool implemented in TypeScript.
 *
 * Tools that only inspect the host run here; anything that touches key material
 * or parses a file format goes to the engine. The difference is invisible above
 * this interface — a surface sees a manifest and a report either way.
 */

import type { Args } from './args.js';
import type { Config } from './config.js';
import type { Host } from './host.js';
import type { ToolManifest } from './manifest.js';
import type { AppPaths } from './paths.js';
import type { Report } from './report.js';

export interface ToolRunContext {
  host: Host;
  config: Config;
  dryRun: boolean;
  /** Where this installation keeps its config, audit trail, and keystore. */
  paths: AppPaths;
}

export interface LocalTool {
  readonly manifest: ToolManifest;
  run(ctx: ToolRunContext, args: Args): Promise<Report>;
}
