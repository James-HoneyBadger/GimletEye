/**
 * Shell completion and the man page, generated from `surface.ts`.
 *
 * Written by hand, both would describe the command line as it was on the day
 * somebody typed them out. Generated from the same declaration `--help` renders,
 * a new flag appears in all four places or in none.
 */

import { VERSION } from '@gimlet-eye/core';

import { BATCH_FLAGS, COMMANDS, ENVIRONMENT, GLOBAL_FLAGS, type CommandEntry } from './surface.js';

export type Shell = 'bash' | 'zsh' | 'fish';

export function isShell(value: string): value is Shell {
  return value === 'bash' || value === 'zsh' || value === 'fish';
}

/** `-q, --quiet` becomes `['-q', '--quiet']`; the space inside `-s FILE` is dropped. */
export function flagNames(entry: CommandEntry): string[] {
  return entry.command
    .split(', ')
    .map((part) => part.trim().split(' ')[0] ?? '')
    .filter((part) => part !== '');
}

function topLevel(): string[] {
  return [...new Set(COMMANDS.map((entry) => entry.command.split(' ')[0] ?? ''))].filter((name) => name !== '');
}

function subcommands(head: string): string[] {
  return COMMANDS.filter((entry) => entry.command.startsWith(`${head} `)).map(
    (entry) => entry.command.split(' ')[1] ?? '',
  );
}

function longFlags(): string[] {
  return [...GLOBAL_FLAGS, ...BATCH_FLAGS].flatMap(flagNames).filter((name) => name.startsWith('--'));
}

function bash(): string {
  const heads = topLevel();
  const cases = heads
    .map((head) => {
      const subs = subcommands(head);
      if (subs.length === 0) return undefined;
      return `        ${head}) COMPREPLY=( $(compgen -W "${subs.join(' ')}" -- "$cur") ) ;;`;
    })
    .filter((line): line is string => line !== undefined);

  return `# gimlet completion for bash: gimlet completions bash > /etc/bash_completion.d/gimlet
_gimlet() {
    local cur
    cur="\${COMP_WORDS[COMP_CWORD]}"
    local commands="${heads.join(' ')}"
    local flags="${[...GLOBAL_FLAGS, ...BATCH_FLAGS].flatMap(flagNames).join(' ')}"
    if [ "\${COMP_CWORD}" -eq 1 ]; then
        COMPREPLY=( $(compgen -W "$commands $flags" -- "$cur") )
        return 0
    fi
    case "\${COMP_WORDS[1]}" in
${cases.join('\n')}
        *) COMPREPLY=( $(compgen -W "$flags" -- "$cur") ) ;;
    esac
}
complete -F _gimlet gimlet
`;
}

function fish(): string {
  const lines: string[] = ['# gimlet completion for fish: gimlet completions fish > ~/.config/fish/completions/gimlet.fish'];
  // Fish quotes with '…', so an apostrophe in a summary has to go rather than
  // close the string early.
  const text = (value: string): string => value.replaceAll("'", '');
  for (const entry of COMMANDS) {
    const [head, sub] = entry.command.split(' ');
    if (sub === undefined) {
      lines.push(`complete -c gimlet -f -n __fish_use_subcommand -a '${head}' -d '${text(entry.summary)}'`);
    } else {
      lines.push(
        `complete -c gimlet -f -n '__fish_seen_subcommand_from ${head}' -a '${sub}' -d '${text(entry.summary)}'`,
      );
    }
  }
  for (const entry of [...GLOBAL_FLAGS, ...BATCH_FLAGS]) {
    const names = flagNames(entry);
    const long = names.find((name) => name.startsWith('--'));
    const short = names.find((name) => /^-\w$/.test(name));
    const parts = ['complete -c gimlet'];
    if (short !== undefined) parts.push(`-s ${short.slice(1)}`);
    if (long !== undefined) parts.push(`-l ${long.slice(2)}`);
    if (entry.args !== '') parts.push('-r');
    parts.push(`-d '${entry.summary.replaceAll("'", '')}'`);
    lines.push(parts.join(' '));
  }
  return `${lines.join('\n')}\n`;
}

function zsh(): string {
  const described = COMMANDS.map(
    (entry) => `        '${entry.command.replaceAll("'", '')}:${entry.summary.replaceAll("'", '')}'`,
  );
  return `#compdef gimlet
# gimlet completion for zsh: gimlet completions zsh > "${'${fpath[1]}'}/_gimlet"
_gimlet() {
    local -a commands flags
    commands=(
${described.join('\n')}
    )
    flags=(${[...GLOBAL_FLAGS, ...BATCH_FLAGS].flatMap(flagNames).join(' ')})
    if (( CURRENT == 2 )); then
        _describe -t commands 'gimlet command' commands
    else
        _values 'option' "$flags[@]"
    fi
}
_gimlet "$@"
`;
}

export function completionScript(shell: Shell): string {
  if (shell === 'bash') return bash();
  if (shell === 'zsh') return zsh();
  return fish();
}

/** Roff for `man 1 gimlet`; no date field, so two builds of a tag match. */
export function manPage(): string {
  const section = (title: string, entries: readonly CommandEntry[], render: (entry: CommandEntry) => string): string =>
    `.SH ${title}\n${entries.map(render).join('\n')}\n`;

  const escape = (text: string): string => text.replaceAll('\\', '\\\\').replaceAll('-', '\\-');
  const command = (entry: CommandEntry): string =>
    `.TP\n.B ${escape(`${entry.command} ${entry.args}`.trim())}\n${escape(entry.summary)}`;

  return `.TH GIMLET 1 "" "gimlet ${VERSION}" "Gimlet Eye manual"
.SH NAME
gimlet \\- one workbench for system, crypto, and privacy operations
.SH SYNOPSIS
.B gimlet
[\\fIOPTIONS\\fR] \\fICOMMAND\\fR [\\fIARGS\\fR]
.SH DESCRIPTION
Every tool is reachable as \\fBgimlet <tool-id> [KEY=VALUE ...]\\fR, and the
desktop app runs the same catalogue, reports, and audit trail.
${section('COMMANDS', COMMANDS, command)}
${section('OPTIONS', GLOBAL_FLAGS, command)}
${section('BATCH OPTIONS', BATCH_FLAGS, command)}
${section('ENVIRONMENT', ENVIRONMENT, command)}
.SH EXIT STATUS
.B 0
for an ok or warning run,
.B 1
for an error verdict or a failed run, and
.B 2
for a command typed wrong.
.SH FILES
.TP
.I ~/.config/gimlet
The default state root: config, audit trail, and keystore.
`;
}
