/**
 * What the window asks of the toolkit.
 *
 * Four questions, answered by the main process: the shell holds the `Runtime`
 * and the filesystem, and this module is the only place that knows how a
 * request reaches it. The UI above is unchanged from the Tauri build because
 * this module's shape is unchanged.
 */

import type { Args, Report, ToolManifest } from '@gimlet-eye/core';

import { bridge, type AuditTail, type Health } from './bridge.js';

export type { ArgSpec, Args, AuditEntry, Finding, Report, ToolManifest } from '@gimlet-eye/core';
export type { AuditTail, Health } from './bridge.js';
export { bridge } from './bridge.js';

export async function fetchHealth(): Promise<Health> {
  return bridge().health();
}

export async function fetchTools(): Promise<ToolManifest[]> {
  return bridge().tools();
}

export async function runTool(tool: string, args: Args, dryRun: boolean): Promise<Report> {
  return bridge().run(tool, args, dryRun);
}

export async function fetchAudit(limit = 50): Promise<AuditTail> {
  return bridge().audit(limit);
}
