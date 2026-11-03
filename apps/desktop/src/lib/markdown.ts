import type { Finding, Report } from './engine';

/**
 * A report's findings as Markdown, one line each.
 *
 * This is the shape a ticket or a chat thread wants, and it is deliberately a
 * summary: the full report has its own renderer in `@gimlet-works/core`, which the
 * CLI uses and the window does not need to duplicate.
 */
export function findingsMarkdown(report: Report, findings: readonly Finding[]): string {
  const lines = findings.map(
    (finding) =>
      `- **${finding.severity}** \`${finding.code}\` — ${finding.message}${
        finding.target ? ` (\`${finding.target}\`)` : ''
      }`,
  );
  return [`## ${report.tool}`, '', report.summary, '', ...lines].join('\n');
}
