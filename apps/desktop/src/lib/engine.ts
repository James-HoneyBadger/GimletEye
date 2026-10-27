/**
 * What the window asks of the toolkit.
 *
 * There is no server and no token: the window holds a `Runtime` from
 * `@gimlet-eye/core` and calls it, exactly as the CLI does. The only thing that
 * crosses a process boundary is the crypto engine, and the shell owns that.
 */

import { Runtime, VERSION } from '@gimlet-eye/core';
import type { Args, AuditEntry, Report, ToolManifest } from '@gimlet-eye/core';

import { tauriHost } from './tauri-host';

export type { ArgSpec, AuditEntry, Finding, Report, ToolManifest } from '@gimlet-eye/core';

export interface Health {
  status: string;
  version: string;
  engine: string;
  tools: number;
  home: string;
}

let runtimePromise: Promise<Runtime> | null = null;

/** The one runtime this window uses. Created on first call, reused after that. */
function runtime(): Promise<Runtime> {
  runtimePromise ??= tauriHost().then((host) => Runtime.load(host));
  return runtimePromise;
}

export async function fetchHealth(): Promise<Health> {
  const live = await runtime();
  return {
    status: 'ok',
    version: VERSION,
    engine: live.engineVersion,
    tools: live.registry.size,
    home: live.paths.root,
  };
}

export async function fetchTools(): Promise<ToolManifest[]> {
  const live = await runtime();
  return live.registry.list();
}

export async function runTool(tool: string, args: Args, dryRun: boolean): Promise<Report> {
  const live = await runtime();
  return (await live.run(tool, args, { dryRun })).report;
}

export async function fetchAudit(limit = 50): Promise<{ entries: AuditEntry[]; path: string; enabled: boolean }> {
  const live = await runtime();
  if (!live.config.audit.enabled) return { entries: [], path: live.audit.path, enabled: false };
  return { entries: await live.auditTail(limit), path: live.audit.path, enabled: true };
}
