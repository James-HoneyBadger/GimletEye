#!/usr/bin/env node
/**
 * The `gimlet-works` command and its `gimlet` compatibility alias.
 *
 * The process exits with 0 for ok, 1 for a failing run, and 2 for a command the
 * user typed wrong — the distinction scripts rely on.
 */

import { main } from './commands.js';
import { commandName } from './name.js';

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(`${commandName()}: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
