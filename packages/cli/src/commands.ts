/**
 * What each command does.
 *
 * Everything here goes through one `Runtime`, so the audit trail is written by
 * the same code whether a person typed the command or a script did.
 */

import { nodeHost } from '@gimlet-eye/core/host-node';
import {
  GimletError,
  Runtime,
  configToToml,
  parseCategory,
  render,
  fromPairs,
  type OutputFormat,
  type Report,
} from '@gimlet-eye/core';

import { executeBatch, type BatchRunner } from './batch.js';
import { parseArgs, type Command, type Globals } from './cli.js';
import { write, writeLine } from './output.js';
import { helpText, versionText } from './help.js';

export async function main(argv: readonly string[], host = nodeHost()): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    if (error instanceof GimletError && error.code === 'invalid_args') {
      process.stderr.write(`gimlet: ${error.message}\n`);
      return 2;
    }
    throw error;
  }

  if (parsed.command.kind === 'help') {
    write(helpText());
    return 0;
  }
  if (parsed.command.kind === 'version') {
    writeLine(versionText());
    return 0;
  }

  let runtime: Runtime | undefined;
  try {
    runtime = await Runtime.load(host, { home: parsed.globals.home, dryRun: parsed.globals.dryRun });
    return await dispatch(runtime, parsed.globals, parsed.command);
  } catch (error) {
    const failure = error instanceof GimletError ? error : new GimletError('internal', String(error));
    process.stderr.write(`gimlet: ${failure.message}\n`);
    return failure.code === 'invalid_args' ? 2 : 1;
  } finally {
    runtime?.close();
  }
}

async function dispatch(runtime: Runtime, globals: Globals, command: Command): Promise<number> {
  switch (command.kind) {
    case 'run':
      return run(runtime, globals, command.tool, command.args);
    case 'batch':
      return runBatch(runtime, globals, command);
    case 'tools-list':
      return listTools(runtime, globals, command.category);
    case 'tools-show':
      return showTool(runtime, globals, command.id);
    case 'config-show':
      return showConfig(runtime, globals);
    case 'config-init':
      return initConfig(runtime, globals, command.force);
    case 'config-path':
      writeLine(runtime.paths.configFile);
      return 0;
    case 'audit':
      return showAudit(runtime, globals, command.limit);
    case 'doctor':
      return doctor(runtime);
    case 'help':
    case 'version':
      return 0;
  }
}

function formatFor(globals: Globals, runtime: Runtime): OutputFormat {
  return globals.format ?? runtime.config.defaults.output;
}

async function run(runtime: Runtime, globals: Globals, toolName: string, rawArgs: readonly string[]): Promise<number> {
  const { report } = await runtime.run(toolName, fromPairs(rawArgs));
  write(render(report, formatFor(globals, runtime)));
  return exitCode(report.status, globals.strict);
}

async function runBatch(
  runtime: Runtime,
  globals: Globals,
  command: Extract<Command, { kind: 'batch' }>,
): Promise<number> {
  const runner: BatchRunner = {
    run: async (tool, args) => (await runtime.run(tool, args)).report,
  };
  const summary = await executeBatch(
    runtime.host,
    runner,
    {
      tool: runtime.require(command.tool).id,
      paths: command.paths,
      args: fromPairs(command.args),
      inputArg: command.inputArg,
      concurrency: command.concurrency,
      failFast: command.failFast,
      extensions: command.extensions,
      recursive: command.recursive,
    },
    formatFor(globals, runtime),
  );
  return exitCode(summary.status, globals.strict);
}

/** `--strict` turns a warning verdict into a failure, so CI gates on findings. */
function exitCode(status: Report['status'], strict: boolean): number {
  if (status === 'error') return 1;
  if (status === 'warning' && strict) return 1;
  return 0;
}

function listTools(runtime: Runtime, globals: Globals, category: string | undefined): number {
  const filter = category === undefined ? undefined : parseCategory(category);
  const manifests = runtime.registry
    .list()
    .filter((manifest) => filter === undefined || manifest.category === filter)
    .sort((a, b) => a.id.localeCompare(b.id));

  if (formatFor(globals, runtime) === 'json') {
    writeLine(JSON.stringify(manifests, null, 2));
    return 0;
  }

  writeLine(
    `${'ID'.padEnd(30)} ${'CATEGORY'.padEnd(11)} ${'WRITES'.padEnd(7)} ${'PLATFORM'.padEnd(9)} SUMMARY`,
  );
  for (const manifest of manifests) {
    const writes = manifest.mutates === true ? 'yes' : '-';
    const platform = manifest.platforms === undefined || manifest.platforms.length === 0 ? 'any' : manifest.platforms.join(',');
    writeLine(`${manifest.id.padEnd(30)} ${manifest.category.padEnd(11)} ${writes.padEnd(7)} ${platform.padEnd(9)} ${manifest.summary}`);
  }
  writeLine(`\n${manifests.length} tool(s)`);
  return 0;
}

function showTool(runtime: Runtime, _globals: Globals, id: string): number {
  writeLine(JSON.stringify(runtime.require(id), null, 2));
  return 0;
}

function showConfig(runtime: Runtime, _globals: Globals): number {
  writeLine(`# ${runtime.paths.configFile}`);
  write(configToToml(runtime.config));
  return 0;
}

async function initConfig(runtime: Runtime, _globals: Globals, force: boolean): Promise<number> {
  const exists = await runtime.host.exists(runtime.paths.configFile);
  if (exists && !force) {
    process.stderr.write(`gimlet: ${runtime.paths.configFile} already exists; pass --force to replace it\n`);
    return 1;
  }
  await runtime.host.createDir(runtime.paths.configDir);
  await runtime.host.writeTextFile(runtime.paths.configFile, configToToml(runtime.config));
  writeLine(`wrote ${runtime.paths.configFile}`);
  return 0;
}

async function showAudit(runtime: Runtime, globals: Globals, limit: number): Promise<number> {
  if (!runtime.config.audit.enabled) {
    writeLine('audit trail is disabled in the configuration');
    return 0;
  }
  const entries = await runtime.auditTail(limit);
  if (entries.length === 0) {
    writeLine(`no audit records at ${runtime.audit.path}`);
    return 0;
  }
  if (formatFor(globals, runtime) === 'json') {
    writeLine(JSON.stringify(entries, null, 2));
    return 0;
  }
  for (const entry of entries) {
    writeLine(
      `${entry.ts}  ${entry.status.padEnd(8)} ${entry.tool.padEnd(30)} ${String(entry.duration_ms).padStart(6)} ms  ${(entry.arg_keys ?? []).join(',')}`,
    );
  }
  return 0;
}

async function doctor(runtime: Runtime): Promise<number> {
  let problems = 0;
  writeLine(versionText());
  writeLine(`platform    ${runtime.host.platform}/${runtime.host.arch}`);
  writeLine(`home        ${runtime.paths.root}`);

  const configExists = await runtime.host.exists(runtime.paths.configFile);
  writeLine(`config      ${runtime.paths.configFile}${configExists ? '' : ' (defaults)'}`);

  try {
    await runtime.host.createDir(runtime.paths.dataDir);
    await runtime.host.createDir(runtime.paths.cacheDir);
    writeLine('state dirs  ok');
  } catch (error) {
    problems += 1;
    writeLine(`state dirs  FAILED: ${error instanceof Error ? error.message : String(error)}`);
  }

  const manifests = runtime.registry.list();
  writeLine(`tools       ${manifests.length} total`);
  for (const category of runtime.registry.categories()) {
    const count = manifests.filter((manifest) => manifest.category === category).length;
    writeLine(`  ${category.padEnd(12)} ${count}`);
  }

  writeLine(`engine      v${runtime.engineVersion}`);
  writeLine(`  verified  crypto + metadata tools run in the Rust engine`);

  if (runtime.config.audit.enabled) {
    const entries = await runtime.audit.readAll();
    writeLine(`audit       ${runtime.audit.path} (${entries.length} record(s))`);
  } else {
    writeLine('audit       disabled');
  }

  const unsupported = manifests.filter(
    (manifest) => manifest.platforms !== undefined && !manifest.platforms.includes(runtime.host.platform),
  );
  for (const manifest of unsupported) {
    writeLine(`note        ${manifest.id} does not run on ${runtime.host.platform}`);
  }

  return problems === 0 ? 0 : 1;
}
