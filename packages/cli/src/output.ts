/**
 * Stdout that survives a closed pipe.
 *
 * `gimlet tools list | head` must finish quietly. A write to a closed pipe
 * raises `EPIPE`, which unhandled turns an ordinary shell pipeline into a
 * backtrace, so every line goes through here.
 */

let patched = false;

function tolerateClosedPipe(): void {
  if (patched) return;
  patched = true;
  process.stdout.on('error', (error: NodeJS.ErrnoException) => {
    // The reader stopped listening; that is how `| head` ends.
    if (error.code === 'EPIPE') return;
    process.stderr.write(`gimlet: cannot write output: ${error.message}\n`);
  });
}

export function write(text: string): void {
  tolerateClosedPipe();
  process.stdout.write(text);
}

export function writeLine(text = ''): void {
  write(`${text}\n`);
}

export function warn(text: string): void {
  process.stderr.write(`gimlet: ${text}\n`);
}

/**
 * A failure, in the shape the caller asked for.
 *
 * A script that runs `--format json` is parsing stdout; giving it a one-line
 * English sentence on stderr means every caller has to re-implement the wording.
 * With `json` it gets `{"error": {"code", "message"}}` and the same exit code.
 */
export function writeFailure(code: string, message: string, format: string | undefined): void {
  if (format === 'json') {
    process.stderr.write(`${JSON.stringify({ error: { code, message } })}\n`);
    return;
  }
  process.stderr.write(`gimlet: ${message}\n`);
}

/** The format named on the command line, for the case where parsing failed. */
export function formatFromArgv(argv: readonly string[]): string | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string;
    if (arg.startsWith('--format=')) return arg.slice('--format='.length);
    if (arg === '--format') return argv[index + 1];
  }
  return undefined;
}
