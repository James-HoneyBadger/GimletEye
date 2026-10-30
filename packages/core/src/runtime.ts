/**
 * The composition root: paths, config, audit, registry, and the engine.
 *
 * Both surfaces go through this. `run` is the only way a tool is executed, which
 * is what keeps the audit trail complete — a surface cannot remember to record a
 * run it did not make here.
 */

import { AuditLog, auditEntry } from './audit.js';
import { loadConfig, type Config } from './config.js';
import { GimletError, asGimletError, unknownTool } from './errors.js';
import { diskUsage } from './tools/disk-usage.js';
import { failedLoginDetector } from './tools/failed-login.js';
import { filePermissions } from './tools/file-permissions.js';
import { kernelHardening } from './tools/kernel-hardening.js';
import { network } from './tools/network.js';
import { systemInfo } from './tools/system-info.js';
import { userAudit } from './tools/user-audit.js';
import { discoverPaths, ensurePaths, type AppPaths } from './paths.js';
import { Registry } from './registry.js';
import { Sidecar } from './sidecar.js';
import { assertDataShape } from './data-schema.js';
import type { Args } from './args.js';
import type { Host } from './host.js';
import type { LocalTool } from './local.js';
import { platformAllows } from './manifest.js';
import { sealed, type Report } from './report.js';

export interface RunOptions {
  dryRun?: boolean;
}

export interface RunResult {
  tool: string;
  report: Report;
}

export interface RuntimeOptions {
  /** Overrides `GIMLET_HOME`; the CLI's `--home`. */
  home?: string | undefined;
  dryRun?: boolean | undefined;
  /**
   * Tools that run in this process. The default set touches the host only
   * through `Host`, so it is safe in a webview; anything that needs `node:crypto`
   * is supplied by the Node entry point instead, because this barrel is bundled
   * into the desktop UI.
   */
  localTools?: readonly LocalTool[];
}

/** Tools that need nothing from Node beyond the `Host` interface. */
export const HOST_TOOLS: readonly LocalTool[] = [
  systemInfo,
  diskUsage,
  kernelHardening,
  network,
  filePermissions,
  userAudit,
  failedLoginDetector,
];

export class Runtime {
  private constructor(
    readonly host: Host,
    readonly paths: AppPaths,
    readonly config: Config,
    readonly audit: AuditLog,
    readonly registry: Registry,
    readonly engineVersion: string,
    private readonly local: Map<string, LocalTool>,
    private readonly sidecar: Sidecar,
    private readonly dryRun: boolean,
  ) {}

  static async load(host: Host, options: RuntimeOptions = {}): Promise<Runtime> {
    const paths = await discoverPaths(host, options.home);
    await ensurePaths(paths, host);
    const config = await loadConfig(paths, host);

    const registry = new Registry();
    const local = new Map<string, LocalTool>();
    for (const tool of options.localTools ?? HOST_TOOLS) {
      local.set(tool.manifest.id, tool);
      registry.register(tool.manifest);
    }

    // The engine is optional. Every tool is built in, so a missing engine is a
    // supported install, not a broken one — but a present engine that speaks the
    // wrong protocol is still an error, because that is a real mismatch.
    let sidecar: Sidecar;
    try {
      sidecar = await Sidecar.open(host);
    } catch (error) {
      const failure = asGimletError(error);
      if (failure.code !== 'not_found') throw failure;
      sidecar = Sidecar.unavailable(failure.message);
    }
    for (const manifest of await sidecar.list()) {
      if (!registry.get(manifest.id)) registry.register(manifest);
    }

    const auditPath = config.audit.path ?? paths.auditFile;
    const audit = new AuditLog(host, auditPath, config.audit.max_entries);

    return new Runtime(
      host,
      paths,
      config,
      audit,
      registry,
      sidecar.version,
      local,
      sidecar,
      options.dryRun ?? config.defaults.dry_run,
    );
  }

  /** Resolve a query the way a surface would, with the CLI's error text. */
  require(query: string) {
    const manifest = this.registry.resolve(query);
    if (manifest) return manifest;
    const suggestions = this.registry.suggest(query, 3);
    const hint =
      suggestions.length === 0
        ? ''
        : suggestions.length === 1
          ? ` Did you mean '${suggestions[0]}'?`
          : ` Did you mean one of: ${suggestions.join(', ')}?`;
    throw unknownTool(`'${query}'.${hint} Run \`gimlet tools list\` to see everything available.`);
  }

  /**
   * Run one tool and record it.
   *
   * A run that fails is recorded too, with the same argument *names* and no
   * values, because repeated failures are exactly what a trail is for.
   */
  async run(query: string, args: Args, options: RunOptions = {}): Promise<RunResult> {
    const manifest = this.require(query);
    const dryRun = options.dryRun ?? this.dryRun;
    const started = Date.now();
    const argKeys = Object.keys(args).sort();

    try {
      const report = await this.execute(manifest.id, args, dryRun);
      await this.record(manifest.id, report.status, Date.now() - started, argKeys);
      return { tool: manifest.id, report };
    } catch (error) {
      const failure = asGimletError(error);
      await this.record(manifest.id, 'error', Date.now() - started, argKeys);
      throw failure;
    }
  }

  private async execute(id: string, args: Args, dryRun: boolean): Promise<Report> {
    // One gate for every surface: a tool that declares platforms is refused
    // here rather than in each dispatch path.
    const manifest = this.registry.get(id);
    if (manifest && !platformAllows(manifest, this.host.platform)) {
      throw new GimletError(
        'unsupported',
        `unsupported operation: ${id} supports ${(manifest.platforms ?? []).join(', ')}; this host is ${this.host.platform}`,
      );
    }
    const local = this.local.get(id);
    const report = local
      ? await local.run({ host: this.host, config: this.config, dryRun, paths: this.paths }, args)
      : await this.sidecar.run(id, args, { dryRun, home: this.paths.root });

    // One choke point for every surface: a report whose `data` drifts from the
    // shape its manifest declares fails here, before a consumer sees it.
    assertDataShape(manifest ?? this.require(id), report.data);
    return deriveVerdict(report);
  }

  private async record(tool: string, status: Report['status'], durationMs: number, argKeys: string[]): Promise<void> {
    if (!this.config.audit.enabled) return;
    try {
      await this.audit.record(auditEntry(tool, status, durationMs, argKeys));
    } catch (error) {
      // A trail that cannot be written must not fail the run that succeeded, but
      // it must be visible.
      console.error(`gimlet: could not write the audit trail: ${asGimletError(error).message}`);
    }
  }

  async auditTail(limit: number) {
    return this.audit.tail(limit);
  }

  close(): void {
    this.sidecar.close();
  }
}

const STATUS_RANK: Record<Report['status'], number> = { ok: 0, warning: 1, error: 2 };

/**
 * Take the more severe of the declared verdict and the one the findings imply.
 *
 * A built-in tool is already sealed, so this is its verdict unchanged. An engine
 * report is not trusted to be: a report that says `ok` while carrying a high
 * finding is exactly what `sealed()` exists to prevent, and a report that says
 * `error` with no findings must not be quietly upgraded to `ok`.
 */
function deriveVerdict(report: Report): Report {
  const derived = sealed(report);
  return STATUS_RANK[report.status] > STATUS_RANK[derived.status] ? report : derived;
}

export { GimletError };
