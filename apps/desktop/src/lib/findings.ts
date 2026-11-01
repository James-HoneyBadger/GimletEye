/**
 * What to do about a finding.
 *
 * Codes are stable contract (`disk.critical`, `metadata.present`), so the mapping
 * from a code to the next tool is data, not prose. A suggestion is offered only
 * when the tool is in the catalogue and the report carries the value the tool
 * needs; otherwise the finding stays a finding.
 */

import type { Finding } from './engine';

export interface Suggestion {
  label: string;
  tool: string;
  args: Record<string, string>;
}

interface Rule {
  match: RegExp;
  label: string;
  tool: string;
  /** Data keys, in order of preference, that fill the tool's first argument. */
  from: string[];
  argument: string;
}

const RULES: Rule[] = [
  {
    match: /^metadata\.(present|remaining)$/,
    label: 'Remove metadata',
    tool: 'privacy.metadata-strip',
    from: ['path', 'input'],
    argument: 'input',
  },
  {
    match: /^disk\./,
    label: 'Show disk usage',
    tool: 'sysadmin.disk-usage',
    from: ['mount', 'path'],
    argument: 'path',
  },
  {
    match: /^login\./,
    label: 'Open failed logins',
    tool: 'sysadmin.failed-login-detector',
    from: [],
    argument: 'source',
  },
  {
    match: /^kernel\./,
    label: 'Review kernel hardening',
    tool: 'sysadmin.kernel-hardening',
    from: [],
    argument: 'profile',
  },
  {
    match: /^network\./,
    label: 'Inspect the network',
    tool: 'sysadmin.network',
    from: [],
    argument: 'interface',
  },
  {
    match: /^drift\./,
    label: 'Compare with the snapshot',
    tool: 'sysadmin.config-drift',
    from: ['path'],
    argument: 'path',
  },
  {
    match: /^crypto\.signature_invalid$/,
    label: 'Verify the signature',
    tool: 'crypto.verify',
    from: ['signature', 'path'],
    argument: 'signature',
  },
];

export function suggestionFor(
  code: string,
  data: unknown,
  available: (toolId: string) => boolean,
): Suggestion | null {
  const rule = RULES.find((entry) => entry.match.test(code));
  if (!rule || !available(rule.tool)) return null;
  const source = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
  const args: Record<string, string> = {};
  for (const key of rule.from) {
    const value = source[key];
    if (typeof value === 'string' && value !== '') {
      args[rule.argument] = value;
      break;
    }
  }
  return { label: rule.label, tool: rule.tool, args };
}

/** Worst first; a severity nobody has seen sorts last rather than first. */
const SEVERITY_ORDER: Record<string, number> = { critical: -1, high: 0, medium: 1, low: 2, info: 3 };

export function severityOrder(severity: string): number {
  return SEVERITY_ORDER[severity] ?? 9;
}

/**
 * Findings in the order a person reads them: severity first, then arrival.
 *
 * Grouping lives beside the rules so that anything else showing findings — a
 * sheet, a future `explain` view — groups them the same way.
 */
export function groupFindings(findings: readonly Finding[]): { severity: string; findings: Finding[] }[] {
  const groups = new Map<string, Finding[]>();
  for (const finding of [...findings].sort((a, b) => severityOrder(a.severity) - severityOrder(b.severity))) {
    const bucket = groups.get(finding.severity) ?? [];
    bucket.push(finding);
    groups.set(finding.severity, bucket);
  }
  return [...groups.entries()].map(([severity, items]) => ({ severity, findings: items }));
}
