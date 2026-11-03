/**
 * What the window can ask for, with no Electron in sight.
 *
 * Kept apart from `main.ts` so the boundary can be tested without a display:
 * `handlers.ts` validates IPC input and calls these; everything deciding what a
 * request *means* is here, and it takes a `Runtime` rather than creating one.
 */

import { VERSION, type Args, type AuditEntry, type Report, type ToolManifest } from '@gimlet-works/core';
import type { Runtime } from '@gimlet-works/core';

export interface Health {
  status: 'ok';
  version: string;
  engine: string;
  tools: number;
  home: string;
  config: string;
  audit: string;
}

/** Health plus the settings the diagnostics sheet reads live. */
export interface DoctorSnapshot extends Health {
  auditEnabled: boolean;
}

export interface AuditTail {
  entries: AuditEntry[];
  path: string;
  enabled: boolean;
}

export interface DesktopApi {
  health(): Promise<Health>;
  doctor(): Promise<DoctorSnapshot>;
  tools(): Promise<ToolManifest[]>;
  run(tool: string, args: Args, dryRun: boolean): Promise<Report>;
  audit(limit: number): Promise<AuditTail>;
}

/** `runtime` is a thunk so the first request pays for loading, not startup. */
export function createApi(runtime: () => Promise<Runtime>): DesktopApi {
  const snapshot = async (): Promise<DoctorSnapshot> => {
    const live = await runtime();
    return {
      status: 'ok',
      version: VERSION,
      engine: live.engineVersion,
      tools: live.registry.size,
      home: live.paths.root,
      config: live.paths.configFile,
      audit: live.paths.auditFile,
      auditEnabled: live.config.audit.enabled,
    };
  };

  return {
    doctor: snapshot,

    /**
     * The same snapshot, without the audit switch.
     *
     * Boot needs the catalogue and the paths; only the diagnostics sheet asks
     * whether the trail is on.
     */
    async health(): Promise<Health> {
      const live = await snapshot();
      return {
        status: live.status,
        version: live.version,
        engine: live.engine,
        tools: live.tools,
        home: live.home,
        config: live.config,
        audit: live.audit,
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
