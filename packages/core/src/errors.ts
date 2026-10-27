/**
 * The one error type crossing every layer.
 *
 * `code` is the machine-readable part: the CLI branches on it for the exit
 * status, and the sidecar sends it across the process boundary, so the strings
 * are part of the contract rather than a debugging detail.
 */
export type ErrorCode =
  | 'config'
  | 'invalid_args'
  | 'not_found'
  | 'io'
  | 'capability_denied'
  | 'tool'
  | 'unsupported'
  | 'internal';

export class GimletError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'GimletError';
  }

  /** What `gimlet: <message>` prints without repeating the category twice. */
  override toString(): string {
    return this.message;
  }
}

/** Narrow whatever crossed a boundary to a code this build knows. */
export function asErrorCode(value: unknown): ErrorCode {
  switch (value) {
    case 'config':
    case 'invalid_args':
    case 'not_found':
    case 'io':
    case 'capability_denied':
    case 'tool':
    case 'unsupported':
    case 'internal':
      return value;
    default:
      return 'tool';
  }
}

export const config = (message: string) => new GimletError('config', `configuration error: ${message}`);
export const invalidArgs = (message: string) => new GimletError('invalid_args', `invalid arguments: ${message}`);
export const notFound = (message: string) => new GimletError('not_found', `not found: ${message}`);
export const io = (message: string) => new GimletError('io', `i/o error: ${message}`);
export const unsupported = (message: string) => new GimletError('unsupported', `unsupported operation: ${message}`);
export const toolFailed = (message: string) => new GimletError('tool', `tool failed: ${message}`);
export const internal = (message: string) => new GimletError('internal', `internal error: ${message}`);

/** Wrap anything thrown by the platform in the one error type. */
export function asGimletError(error: unknown): GimletError {
  if (error instanceof GimletError) return error;
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return notFound(error.message);
    if (code === 'EACCES' || code === 'EPERM') return io(error.message);
    return internal(error.message);
  }
  return internal(String(error));
}
