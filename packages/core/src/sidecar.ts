/**
 * The conversation with the verified engine.
 *
 * Every tool is implemented in `packages/engine` now, so this is optional: it
 * is used when one is present, and its absence is a supported state rather than
 * a startup failure. What the engine still buys is an independent implementation
 * of the container format that can be asked for a second opinion — which is why
 * this client survives the port instead of being deleted with the binary.
 */

import { invalidArgs, toolFailed, unsupported } from './errors.js';
import type { EngineTransport, Host } from './host.js';
import type { ToolManifest } from './manifest.js';
import type { Args } from './args.js';
import type { Report } from './report.js';

/** The protocol this client speaks; the engine refuses anything else. */
export const ENGINE_PROTOCOL_VERSION = 1;

export interface Handshake {
  protocol_version: number;
  version: string;
}

export class Sidecar {
  private tools: ToolManifest[] | null = null;

  private constructor(
    private readonly transport: EngineTransport | null,
    readonly version: string,
    /** Why there is no engine, when there is none. */
    private readonly problem = '',
  ) {}

  /** A runtime with no engine: local tools work, and anything that needed the
   * engine says which part is missing instead of claiming the tool is unknown. */
  static unavailable(reason: string): Sidecar {
    return new Sidecar(null, 'none', reason);
  }

  get available(): boolean {
    return this.transport !== null;
  }

  static async open(host: Host): Promise<Sidecar> {
    const transport = await host.engine();
    const reply = (await transport.request({ op: 'handshake' })) as {
      protocol_version?: number;
      version?: string;
    };
    const protocol = reply.protocol_version;
    if (typeof protocol !== 'number' || protocol !== ENGINE_PROTOCOL_VERSION) {
      transport.close();
      throw unsupported(
        `the engine speaks protocol ${protocol ?? 'unknown'}; this build speaks ${ENGINE_PROTOCOL_VERSION}. Rebuild both.`,
      );
    }
    return new Sidecar(transport, reply.version ?? 'unknown');
  }

  /** Every tool the engine offers. Cached: the catalogue cannot change while it runs. */
  async list(): Promise<ToolManifest[]> {
    if (!this.available) return [];
    if (this.tools) return this.tools;
    const reply = (await this.transport!.request({ op: 'list' })) as { tools?: ToolManifest[] };
    if (!Array.isArray(reply.tools)) {
      throw toolFailed('the engine answered a list request without a tool list');
    }
    this.tools = reply.tools;
    return this.tools;
  }

  async run(tool: string, args: Args, options: { dryRun: boolean; home: string }): Promise<Report> {
    const transport = this.transport;
    if (transport === null) {
      throw toolFailed(`'${tool}' is not built into this install, and there is no engine to run it: ${this.problem}`);
    }
    const reply = (await transport.request({
      op: 'run',
      tool,
      args,
      dry_run: options.dryRun,
      home: options.home,
    })) as { report?: Report };
    if (!reply.report) throw toolFailed(`the engine returned no report for '${tool}'`);
    return assertReport(reply.report, tool);
  }

  close(): void {
    this.transport?.close();
  }
}

const STATUSES = new Set<unknown>(['ok', 'warning', 'error']);
const SEVERITIES = new Set<unknown>(['info', 'low', 'medium', 'high', 'critical']);

/**
 * Reject an engine reply that is not shaped like a tool run, before it reaches
 * a renderer.
 *
 * A `status` or `severity` this build does not know is refused rather than
 * passed through: `sealed()` rates an unknown severity as *not a finding*, so a
 * typo in an engine could turn a critical result into `ok`.
 */
export function assertReport(value: unknown, tool: string): Report {
  const malformed = (why: string) => invalidArgs(`malformed report for '${tool}': ${why}`);
  if (typeof value !== 'object' || value === null) throw malformed('not an object');
  const report = value as Partial<Report>;
  if (report.tool !== tool) {
    throw malformed(`tool ${JSON.stringify(report.tool)} does not match '${tool}'`);
  }
  if (!STATUSES.has(report.status)) {
    throw malformed(`status ${JSON.stringify(report.status)} is not ok, warning, or error`);
  }
  if (typeof report.summary !== 'string') throw malformed('summary is not a string');
  if (typeof report.duration_ms !== 'number' || !Number.isFinite(report.duration_ms)) {
    throw malformed('duration_ms is not a number');
  }
  if (report.findings !== undefined) {
    if (!Array.isArray(report.findings)) throw malformed('findings is not an array');
    for (const [index, raw] of report.findings.entries()) {
      const finding = raw as unknown as Record<string, unknown>;
      if (typeof finding !== 'object' || finding === null) throw malformed(`findings[${index}] is not an object`);
      if (!SEVERITIES.has(finding['severity'])) {
        throw malformed(`findings[${index}].severity ${JSON.stringify(finding['severity'])} is not a known severity`);
      }
      if (typeof finding['code'] !== 'string' || typeof finding['message'] !== 'string') {
        throw malformed(`findings[${index}] needs a string code and message`);
      }
      if (finding['target'] !== undefined && typeof finding['target'] !== 'string') {
        throw malformed(`findings[${index}].target is not a string`);
      }
    }
  }
  if (report.warnings !== undefined) {
    if (!Array.isArray(report.warnings) || report.warnings.some((warning) => typeof warning !== 'string')) {
      throw malformed('warnings must be an array of strings');
    }
  }
  if (report.body !== undefined && typeof report.body !== 'string') {
    throw malformed('body is not a string');
  }
  return report as Report;
}
