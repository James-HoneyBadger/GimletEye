import { escapeHtml } from './format';

const MAX_COLUMNS = 8;
const MAX_DEPTH = 3;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isScalar(value: unknown): boolean {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function scalarText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

/** Compact rendering for a value inside a table cell or definition list. */
function inline(value: unknown): string {
  if (isScalar(value)) {
    const text = scalarText(value);
    if (text === '') return '<span class="muted">—</span>';
    return typeof value === 'number'
      ? `<span class="num">${escapeHtml(text)}</span>`
      : escapeHtml(text);
  }
  if (Array.isArray(value)) {
    return `<span class="chip chip--quiet">${value.length} item${value.length === 1 ? '' : 's'}</span>`;
  }
  return '<span class="chip chip--quiet">object</span>';
}

function table(rows: Record<string, unknown>[]): string {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))].slice(0, MAX_COLUMNS);
  const head = columns.map((column) => `<th>${escapeHtml(column.replace(/_/g, ' '))}</th>`).join('');
  const body = rows
    .map(
      (row) =>
        `<tr>${columns
          .map((column) => {
            const align = typeof row[column] === 'number' ? ' class="right"' : '';
            return `<td${align}>${inline(row[column])}</td>`;
          })
          .join('')}</tr>`,
    )
    .join('');
  const truncated = rows.some((row) => Object.keys(row).length > MAX_COLUMNS);
  const more = truncated ? `<caption>Showing the first ${MAX_COLUMNS} columns</caption>` : '';
  return `<div class="table-wrap"><table class="data-table">${more}<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

/** `metadata_bytes` → `Metadata bytes`, so labels read like prose. */
function fieldLabel(key: string): string {
  const text = key.replace(/[_-]/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function definitionList(entries: [string, unknown][]): string {
  const rows = entries
    .map(
      ([key, value]) =>
        `<div class="kv-row"><dt>${escapeHtml(fieldLabel(key))}</dt><dd>${inline(value)}</dd></div>`,
    )
    .join('');
  return `<dl class="kv-list">${rows}</dl>`;
}

function jsonBlock(value: unknown): string {
  return `<pre class="code-block">${escapeHtml(JSON.stringify(value, null, 2))}</pre>`;
}

function render(value: unknown, depth: number): string {
  if (value === null || value === undefined) {
    return '<p class="muted">No structured data.</p>';
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return '<p class="muted">Empty list.</p>';
    if (value.every(isPlainObject)) return table(value as Record<string, unknown>[]);
    if (value.every(isScalar)) {
      return `<ul class="value-list">${value
        .map((item) => `<li><code>${escapeHtml(scalarText(item))}</code></li>`)
        .join('')}</ul>`;
    }
    return jsonBlock(value);
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return '<p class="muted">Empty object.</p>';

    if (entries.every(([, item]) => isScalar(item))) {
      return definitionList(entries);
    }
    if (depth >= MAX_DEPTH) return jsonBlock(value);

    // Scalars read best as one compact list; nested values get their own block.
    const scalars = entries.filter(([, item]) => isScalar(item));
    const composites = entries.filter(([, item]) => !isScalar(item));

    const parts: string[] = [];
    if (scalars.length > 0) parts.push(definitionList(scalars));
    if (composites.length > 0) {
      const sections = composites
        .map(([key, item]) => {
          const label = escapeHtml(fieldLabel(key));
          if (isPlainObject(item) && Object.entries(item).every(([, inner]) => isScalar(inner))) {
            return `<section class="data-section"><h4>${label}</h4>${definitionList(Object.entries(item))}</section>`;
          }
          if (Array.isArray(item)) {
            return `<section class="data-section"><h4>${label} <span class="count">${item.length}</span></h4>${render(item, depth + 1)}</section>`;
          }
          return `<section class="data-section"><h4>${label}</h4>${render(item, depth + 1)}</section>`;
        })
        .join('');
      parts.push(`<div class="data-sections">${sections}</div>`);
    }
    return parts.join('');
  }

  return `<p class="value-inline">${escapeHtml(scalarText(value))}</p>`;
}

/** Render arbitrary tool data as tables, definition lists, or a code block. */
export function renderData(value: unknown): string {
  return `<div class="data-view">${render(value, 0)}</div>`;
}
