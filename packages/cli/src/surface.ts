/**
 * The command surface, declared once.
 *
 * `--help` is rendered from this, and `scripts/check-public-surface.sh` reads it
 * to compare the declaration with `docs/COMPATIBILITY.md`. A flag that exists in
 * the parser but not here would be invisible to both, so the parser and this
 * list are checked against each other by the tests.
 */

export interface CommandEntry {
  /** How it is typed, e.g. `tools list`. */
  readonly command: string;
  /** Arguments that follow it. */
  readonly args: string;
  readonly summary: string;
}

export const COMMANDS: readonly CommandEntry[] = [
  { command: 'run', args: '<tool> [KEY=VALUE...]', summary: 'Run one tool' },
  { command: 'batch', args: '<tool> <PATH...>', summary: 'Run a tool over many files' },
  { command: 'tools list', args: '[--category C]', summary: 'List the catalogue' },
  { command: 'tools show', args: '<id>', summary: "Print one tool's manifest as JSON" },
  { command: 'config show', args: '', summary: 'Print the effective configuration' },
  { command: 'config init', args: '[--force]', summary: 'Write a default configuration file' },
  { command: 'config path', args: '', summary: 'Print the configuration file path' },
  { command: 'audit', args: '[--limit N]', summary: 'Recent audit records' },
  { command: 'doctor', args: '', summary: 'Check the installation' },
  { command: 'tui', args: '', summary: 'Browse and run tools in the terminal' },
  { command: 'help', args: '', summary: 'This text' },
  { command: 'version', args: '', summary: 'Print the version' },
];

export const GLOBAL_FLAGS: readonly CommandEntry[] = [
  { command: '--home', args: '<DIR>', summary: 'Override the toolkit home' },
  { command: '--format', args: '<F>', summary: 'text | json | markdown | csv | html' },
  { command: '--json', args: '', summary: 'Shorthand for --format json' },
  { command: '--output', args: '<FILE>', summary: 'Write the report to a file instead of stdout' },
  { command: '-q, --quiet', args: '', summary: 'Nothing on stdout; the exit status is the answer' },
  { command: '--dry-run', args: '', summary: 'Report intended changes without writing them' },
  { command: '--strict', args: '', summary: 'Treat warnings as failures' },
  { command: '-v, --verbose', args: '', summary: 'More logging on stderr (repeatable)' },
  { command: '-h, --help', args: '', summary: 'This text' },
  { command: '-V, --version', args: '', summary: 'Print the version' },
];

export const BATCH_FLAGS: readonly CommandEntry[] = [
  { command: '--arg', args: '<KEY=VALUE>', summary: 'Tool argument (repeatable)' },
  { command: '--input-arg', args: '<NAME>', summary: 'Argument that receives each path (default: input)' },
  { command: '-c, --concurrency', args: '<N>', summary: 'Files processed at once, 1-32 (default: 4)' },
  { command: '--fail-fast', args: '', summary: 'Stop after the first failure' },
  { command: '--ext', args: '<EXT>', summary: 'Only this extension (repeatable)' },
  { command: '--no-recursive', args: '', summary: 'Do not descend into subdirectories' },
];

export const ENVIRONMENT: readonly CommandEntry[] = [
  { command: 'GIMLET_HOME', args: '', summary: 'Toolkit home; a config at ~/.config/gimlet is the default' },
  { command: 'GIMLET_SIDECAR', args: '', summary: 'Path to the engine binary, when it is not installed beside this program' },
];
