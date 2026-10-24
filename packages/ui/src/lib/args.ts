import type { ToolManifest } from './api';
import type { RawValues } from './store';

/** Read the rendered form exactly as the user left it. */
export function readForm(root: ParentNode): RawValues {
  const values: RawValues = {};
  for (const input of root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-type]')) {
    values[input.name] = input instanceof HTMLInputElement && input.type === 'checkbox'
      ? input.checked
      : input.value;
  }
  return values;
}

/** Coerce form values into the payload the engine expects. */
export function toPayload(tool: ToolManifest, values: RawValues): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
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
    const text = typeof value === 'string' ? value.trim() : '';
    if (spec.required && (value === undefined || text === '')) {
      errors[spec.name] = spec.type === 'path' ? 'Choose a file or directory' : 'Required';
      continue;
    }
    if (spec.type === 'integer' && text !== '' && !/^-?\d+$/.test(text)) {
      errors[spec.name] = 'Whole number expected';
    }
  }
  return errors;
}
