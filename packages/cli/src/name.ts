import { basename } from 'node:path';

/** Keep the legacy command's textual output compatible when it is invoked. */
export function commandName(entry = process.argv[1]): 'gimlet' | 'gimlet-works' {
  return entry !== undefined && basename(entry).toLowerCase() === 'gimlet' ? 'gimlet' : 'gimlet-works';
}
