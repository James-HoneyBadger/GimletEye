import type { Args, ToolManifest } from '@gimlet-eye/core';
import type { RawValues } from './store';

/** Read the rendered form exactly as the user left it. */
export function readForm(root: ParentNode): RawValues {
  const values: RawValues = {};
  for (const input of root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-type]')) {
    if (input instanceof HTMLInputElement) {
      if (input.type === 'checkbox') {
        values[input.name] = input.checked;
        continue;
      }
      // A radio group contributes its *checked* option only: the unchecked ones
      // carry values too, and reading them would report whichever came last.
      if (input.type === 'radio') {
        if (input.checked) values[input.name] = input.value;
        continue;
      }
      values[input.name] = input.value;
      continue;
    }
    values[input.name] = input.value;
  }
  return values;
}

/** Coerce form values into the payload the engine expects. */
export function toPayload(tool: ToolManifest, values: RawValues): Args {
  const payload: Args = {};
  for (const spec of tool.args ?? []) {
    const value = values[spec.name];
    if (value === undefined) continue;
    if (typeof value === 'boolean') {
      payload[spec.name] = value;
      continue;
    }
    if (value === '') continue;
    payload[spec.name] = spec.type === 'integer' ? Number(value) : value;
  }
  return payload;
}

export function validateArgs(tool: ToolManifest, values: RawValues): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const spec of tool.args ?? []) {
    const value = values[spec.name];
    const missing = value === undefined || (typeof value === 'string' && value.trim() === '');
    if (spec.required && missing) {
      errors[spec.name] = spec.type === 'path' ? 'Choose a file or directory' : 'Required';
      continue;
    }
    if (spec.type === 'integer' && typeof value === 'string' && value !== '' && !/^-?\d+$/.test(value.trim())) {
      errors[spec.name] = 'Whole number expected';
    }
  }
  return errors;
}
