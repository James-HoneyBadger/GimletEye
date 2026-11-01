/**
 * What a form needs to know about a tool's arguments.
 *
 * The manifest declares types; a form needs decisions. Which dialog a `path`
 * argument should open, and which inputs deserve masking, are read from the
 * name and the help text — once, here, so every surface offers the same thing.
 */

import { isSecretArg } from './args.js';
import type { ArgSpec, ToolManifest } from './manifest.js';

export interface DescribedArg {
  spec: ArgSpec;
  /**
   * What a picker should offer: a file, a folder, either, or nothing (type it).
   *
   * The manifest has no `directory` type, so the decision is read from the name
   * and the help text.
   */
  picker: 'file' | 'directory' | 'either' | null;
  secret: boolean;
}

const DIRECTORY_NAME = /^(dir|directory|homedir)$/i;
const DIRECTORY_HELP = /\b(directory|folder|home directory|root of)\b/i;
const EITHER_HELP = /\bfile or directory\b/i;

/**
 * Arguments with the decisions a form needs, derived once from the manifest.
 *
 * Surfaces used to re-derive this per component — the workbench guessed at the
 * picker from the name and help itself — which is how two views end up offering
 * different dialogs for the same tool.
 */
export function describeArgs(tool: ToolManifest): DescribedArg[] {
  return (tool.args ?? []).map((spec) => {
    const help = spec.help ?? '';
    let picker: DescribedArg['picker'] = null;
    if (spec.type === 'path') {
      if (EITHER_HELP.test(help)) picker = 'either';
      else if (DIRECTORY_NAME.test(spec.name) || DIRECTORY_HELP.test(help)) picker = 'directory';
      else picker = 'file';
    }
    return { spec, picker, secret: spec.type === 'string' && isSecretArg(spec.name) };
  });
}
