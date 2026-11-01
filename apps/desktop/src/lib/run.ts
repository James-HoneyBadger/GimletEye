import { toPayload, validateArgs, readForm } from './args';
import { cliCommand } from './format';
import type { Args, ToolManifest } from './engine';
import type { RawValues } from './store';

/** What a run would send, and the command that would repeat it. */
export interface RunInput {
  payload: Args;
  dryRun: boolean;
  command: string;
  errors: Record<string, string>;
}

/**
 * Where the values for a run come from.
 *
 * In the compose view the form is the truth; in the report view it is not on
 * screen at all, and the draft the last run used is. Reading the form
 * unconditionally is how "Run again" once sent an empty argument set and then
 * overwrote the draft with it.
 */
export function resolveRunValues(
  root: ParentNode,
  draft: RawValues,
): { values: RawValues; fromForm: boolean } {
  const form = root.querySelector('#args');
  return form ? { values: readForm(root), fromForm: true } : { values: draft, fromForm: false };
}

export function runInput(tool: ToolManifest, values: RawValues, dryRun: boolean): RunInput {
  const effective = tool.mutates ? dryRun : false;
  const payload = toPayload(tool, values);
  return {
    payload,
    dryRun: effective,
    command: cliCommand(tool.id, payload, effective),
    errors: validateArgs(tool, values),
  };
}

/** A run needs a tool and no run already in flight. */
export function canRun(tool: ToolManifest | null, running: boolean): tool is ToolManifest {
  return tool !== null && !running;
}
