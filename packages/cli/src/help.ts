import { VERSION } from '@gimlet-eye/core';

export function versionText(): string {
  return `gimlet ${VERSION}`;
}

export function helpText(): string {
  return `Gimlet Eye ${VERSION} — one workbench for system, crypto, and privacy operations

Any tool can be invoked directly: \`gimlet system-info\` is shorthand for
\`gimlet run system-info\`.

USAGE:
    gimlet [OPTIONS] <COMMAND>

COMMANDS:
    run <tool> [KEY=VALUE...]     Run one tool
    batch <tool> <PATH...>        Run a tool over many files
    tools list [--category C]     List the catalogue
    tools show <id>               Print one tool's manifest as JSON
    config show|init|path         Configuration
    audit [--limit N]             Recent audit records
    doctor                        Check the installation
    help                          This text
    version                       Print the version

OPTIONS:
        --home <DIR>      Override the toolkit home (config, audit, keystore)
        --format <F>      text | json | markdown | csv
        --json            Shorthand for --format json
        --dry-run         Report intended changes without writing them
        --strict          Treat warnings as failures
    -v, --verbose         More logging on stderr (repeatable)
    -h, --help            This text
    -V, --version         Print the version

BATCH OPTIONS:
        --arg <KEY=VALUE>   Tool argument (repeatable)
        --input-arg <NAME>  Argument that receives each path (default: input)
    -c, --concurrency <N>   Files processed at once, 1-32 (default: 4)
        --fail-fast         Stop after the first failure
        --ext <EXT>         Only this extension (repeatable)
        --no-recursive      Do not descend into subdirectories

ENVIRONMENT:
    GIMLET_HOME           Toolkit home; a config at ~/.config/gimlet is the default
    GIMLET_SIDECAR        Path to the engine binary, when it is not installed
                          beside this program
`;
}
