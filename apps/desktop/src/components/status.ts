import { escapeHtml } from '../lib/format';
import { icons } from './icons';

/**
 * A verdict as an icon and a word, never colour alone.
 *
 * The audit trail and a report are read on a screen that may be greyscale, by
 * someone who may not see the dot's hue, so the status says what it is.
 */
export function statusBadge(status: string): string {
  const icon = status === 'ok' ? icons.check : status === 'warning' ? icons.warning : icons.error;
  return `<span class="status status--${escapeHtml(status)}">${icon}${escapeHtml(status)}</span>`;
}
