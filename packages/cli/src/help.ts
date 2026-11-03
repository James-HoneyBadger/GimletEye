import { VERSION } from '@gimlet-works/core';

import { commandName } from './name.js';
import { BATCH_FLAGS, COMMANDS, ENVIRONMENT, GLOBAL_FLAGS, type CommandEntry } from './surface.js';

export function versionText(): string {
  return `${commandName()} ${VERSION}`;
}

function section(title: string, entries: readonly CommandEntry[]): string {
  const width = entries.reduce((max, entry) => Math.max(max, `${entry.command} ${entry.args}`.trim().length), 0);
  const lines = entries.map((entry) => {
    const left = `${entry.command} ${entry.args}`.trim();
    return `    ${left.padEnd(width)}  ${entry.summary}`;
  });
  return `${title}\n${lines.join('\n')}\n`;
}

export function helpText(): string {
  return `Gimlet Works ${VERSION} — one workbench for system, crypto, and privacy operations

Any tool can be invoked directly: \`gimlet-works system-info\` is shorthand for
\`gimlet-works run system-info\`. The legacy \`gimlet\` command remains an alias.

USAGE
    gimlet-works [OPTIONS] <COMMAND>

${section('COMMANDS', COMMANDS)}
${section('OPTIONS', GLOBAL_FLAGS)}
${section('BATCH OPTIONS', BATCH_FLAGS)}
${section('ENVIRONMENT', ENVIRONMENT)}`;
}
