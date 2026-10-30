/**
 * The refusal shared by every tool that writes a file.
 *
 * "Do not write over your own input" sounds like advice rather than a guard,
 * but the failure is silent and complete: a container decrypted onto itself is
 * gone, and a document signed onto itself is replaced by its signature. The Rust
 * implementation refused in all three places; the TypeScript port did not, and
 * nothing in the suite noticed.
 */

import { invalidArgs } from '../errors.js';
import { normalize } from '../pathutil.js';
import type { LocalTool, ToolRunContext } from '../local.js';

/**
 * Do two paths name the same file?
 *
 * Canonicalised when both exist, so a symlink, a `./` prefix, or a `../` detour
 * counts as the same file; compared as normalised strings otherwise, because the
 * destination of a write usually does not exist yet.
 */
export async function samePath(ctx: ToolRunContext, left: string, right: string): Promise<boolean> {
  if (normalize(left) === normalize(right)) return true;
  try {
    return (await ctx.host.resolve(left)) === (await ctx.host.resolve(right));
  } catch (error) {
    // A destination that does not exist yet is the ordinary case and means the
    // paths differ. Anything else — a permission error, an unusable path — must
    // not be read as "different", or the guard fails open and the input is
    // overwritten.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/** Throw unless `target` is a different file from `input`. */
export async function refuseSamePath(ctx: ToolRunContext, input: string, target: string): Promise<void> {
  if (await samePath(ctx, input, target)) {
    throw invalidArgs(`output ${target} is the input file; choose another path`);
  }
}
