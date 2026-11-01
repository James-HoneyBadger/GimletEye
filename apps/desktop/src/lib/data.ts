import type { DataSpec, ToolManifest } from './engine';
import { escapeHtml } from './format';

const MAX_COLUMNS = 8;
const MAX_DEPTH = 3;
/** Rows kept in the DOM; a drift report over a large tree can be thousands. */
const MAX_ROWS = 500;

export interface Sort {
  column: string;
  direction: 1 | -1;
}

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

function columnsFor(rows: Record<string, unknown>[], spec: DataSpec | undefined): string[] {
  const declared = spec?.shape === 'array' && spec.row ? Object.keys(spec.row) : [];
  const seen = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return [...declared.filter((key) => seen.includes(key)), ...seen.filter((key) => !declared.includes(key))].slice(
    0,
    MAX_COLUMNS,
  );
}

function isNumeric(key: string, rows: Record<string, unknown>[], spec: DataSpec | undefined): boolean {
  if (spec?.shape === 'array' && spec.row) {
    const field = spec.row[key];
    if (typeof field === 'string') return field.split('|')[0] === 'number';
  }
  return rows.every((row) => row[key] === undefined || row[key] === null || typeof row[key] === 'number');
}

function sorted(rows: Record<string, unknown>[], sort: Sort | undefined): Record<string, unknown>[] {
  if (!sort) return rows;
  return [...rows].sort((left, right) => {
    const a = left[sort.column];
    const b = right[sort.column];
    if (typeof a === 'number' && typeof b === 'number') return (a - b) * sort.direction;
    return String(a ?? '').localeCompare(String(b ?? '')) * sort.direction;
  });
}

function table(rows: Record<string, unknown>[], spec: DataSpec | undefined, sort: Sort | undefined): string {
  const columns = columnsFor(rows, spec);
  const numeric = new Map(columns.map((column) => [column, isNumeric(column, rows, spec)]));
  const visible = sorted(rows, sort).slice(0, MAX_ROWS);

  const head = columns
    .map((column) => {
      const active = sort?.column === column;
      const marker = active ? (sort.direction === 1 ? '↑' : '↓') : '';
      return `<th${numeric.get(column) ? ' class="right"' : ''} aria-sort="${
        active ? (sort.direction === 1 ? 'ascending' : 'descending') : 'none'
      }"><button class="sort" data-sort="${escapeHtml(column)}">${escapeHtml(column.replace(/_/g, ' '))}<span class="sort-mark">${marker}</span></button></th>`;
    })
    .join('');

  const body = visible
    .map(
      (row) =>
        `<tr>${columns
          .map((column) => {
            const value = row[column];
            const align = numeric.get(column) ? ' class="right"' : '';
            return `<td${align}>${inline(value)}</td>`;
          })
          .join('')}</tr>`,
    )
    .join('');

  const notes: string[] = [];
  const totalColumns = new Set(rows.flatMap((row) => Object.keys(row))).size;
  if (totalColumns > MAX_COLUMNS) notes.push(`Showing the first ${MAX_COLUMNS} of ${totalColumns} columns`);
  if (rows.length > MAX_ROWS) notes.push(`Showing ${MAX_ROWS} of ${rows.length} rows; export the JSON for all`);
  const more = notes.length > 0 ? `<caption>${escapeHtml(notes.join(' · '))}</caption>` : '';
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

function render(value: unknown, depth: number, spec?: DataSpec, sort?: Sort): string {
  if (value === null || value === undefined) {
    return '<p class="muted">No structured data.</p>';
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return '<p class="muted">Empty list.</p>';
    if (value.every(isPlainObject)) return table(value as Record<string, unknown>[], spec, sort);
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

/**
 * Render tool data as tables, definition lists, or a code block.
 *
 * The manifest's `DataSpec` decides column order and which columns are numbers;
 * the value alone cannot, because an empty column has no type.
 */
export function renderData(value: unknown, spec?: DataSpec, sort?: Sort): string {
  return `<div class="data-view">${render(value, 0, spec, sort)}</div>`;
}

export function dataSpecOf(tool: ToolManifest | null): DataSpec | undefined {
  return tool?.data;
}
