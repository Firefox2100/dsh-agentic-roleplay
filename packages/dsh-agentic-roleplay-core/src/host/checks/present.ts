import { SEVERITIES, type CheckReport } from '../../shared/checks.ts'

/** The most findings a tool result lists: the rest are counted. */
const LISTED = 40
const RESOLVED_LISTED = 10

/** What the assistant reads of a report: counts first, the worst findings, then what changed since the last run. */
export function presentReport(report: CheckReport): object {
  const count = (severity: string): number => report.findings.filter(finding => finding.severity === severity).length
  return {
    ok: count('error') === 0,
    counts: Object.fromEntries(SEVERITIES.map(severity => [severity, count(severity)])),
    findings: report.findings.slice(0, LISTED),
    more: Math.max(0, report.findings.length - LISTED),
    skipped: report.skipped,
    ...(report.changes === undefined ? {} : { since_last_run: { new: report.changes.added, resolved: report.changes.resolved.slice(0, RESOLVED_LISTED), resolved_count: report.changes.resolved.length } }),
  }
}
