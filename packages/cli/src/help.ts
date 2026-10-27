import { VERSION } from '@gimlet-eye/core';

import { BATCH_FLAGS, COMMANDS, ENVIRONMENT, GLOBAL_FLAGS, type CommandEntry } from './surface.js';

export function versionText(): string {
  return `gimlet ${VERSION}`;
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
  return `Gimlet Eye ${VERSION} — one workbench for system, crypto, and privacy operations

Any tool can be invoked directly: \`gimlet system-info\` is shorthand for
\`gimlet run system-info\`.

USAGE
    gimlet [OPTIONS] <COMMAND>

${section('COMMANDS', COMMANDS)}
${section('OPTIONS', GLOBAL_FLAGS)}
${section('BATCH OPTIONS', BATCH_FLAGS)}
${section('ENVIRONMENT', ENVIRONMENT)}`;
}
