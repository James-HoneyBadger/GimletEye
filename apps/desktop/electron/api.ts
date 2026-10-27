/**
 * What the window can ask for, with no Electron in sight.
 *
 * Kept apart from `main.ts` so the boundary can be tested without a display:
 * `main.ts` validates IPC input and calls these; everything deciding what a
 * request *means* is here, and it takes a `Runtime` rather than creating one.
 */

import { VERSION, type Args, type AuditEntry, type Report, type ToolManifest } from '@gimlet-eye/core';
import type { Runtime } from '@gimlet-eye/core';

export interface Health {
  status: 'ok';
  version: string;
  engine: string;
  tools: number;
  home: string;
}

export interface AuditTail {
  entries: AuditEntry[];
  path: string;
  enabled: boolean;
}

export interface DesktopApi {
  health(): Promise<Health>;
  tools(): Promise<ToolManifest[]>;
  run(tool: string, args: Args, dryRun: boolean): Promise<Report>;
  audit(limit: number): Promise<AuditTail>;
}

/** `runtime` is a thunk so the first request pays for loading, not startup. */
export function createApi(runtime: () => Promise<Runtime>): DesktopApi {
  return {
    async health(): Promise<Health> {
      const live = await runtime();
      return {
        status: 'ok',
        version: VERSION,
        engine: live.engineVersion,
        tools: live.registry.size,
        home: live.paths.root,
      };
    },

    async tools(): Promise<ToolManifest[]> {
      return (await runtime()).registry.list();
    },

    async run(tool: string, args: Args, dryRun: boolean): Promise<Report> {
      const { report } = await (await runtime()).run(tool, args, { dryRun });
      return report;
    },

    async audit(limit: number): Promise<AuditTail> {
      const live = await runtime();
      if (!live.config.audit.enabled) return { entries: [], path: live.audit.path, enabled: false };
      return { entries: await live.auditTail(limit), path: live.audit.path, enabled: true };
    },
  };
}
