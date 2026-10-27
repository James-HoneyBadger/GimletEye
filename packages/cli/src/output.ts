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
