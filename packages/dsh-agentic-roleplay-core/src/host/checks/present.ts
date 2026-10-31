import { SEVERITIES, type CheckReport, type Finding } from '../../shared/checks.ts'

/** The most findings a tool result lists: the rest are counted. */
const LISTED = 40
const RESOLVED_LISTED = 10
/** More findings than this of one kind are told as one, with the others' places, so a big world's hundred alike do not bury the rest. */
const GROUPED_AT = 5
const ALSO_LISTED = 8

export type Presented = Finding & { count?: number; also?: string[] }

/** The findings as the assistant reads them: those of one check and code beyond a few are one entry that says how many there are and where. */
export function grouped(findings: readonly Finding[]): Presented[] {
  const kinds = new Map<string, Finding[]>()
  for (const finding of findings) {
    const key = `${finding.check}\n${finding.code}`
    kinds.set(key, [...kinds.get(key) ?? [], finding])
  }
  return [...kinds.values()].flatMap((same): Presented[] => (same.length <= GROUPED_AT ? same : [{ ...same[0]!, count: same.length, also: same.slice(1, 1 + ALSO_LISTED).map(finding => finding.where) }]))
    .sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity))
}

/** What the assistant reads of a report: counts first, the worst findings, then what changed since the last run. */
export function presentReport(report: CheckReport): object {
  const count = (severity: string): number => report.findings.filter(finding => finding.severity === severity).length
  const presented = grouped(report.findings)
  return {
    ok: count('error') === 0,
    counts: Object.fromEntries(SEVERITIES.map(severity => [severity, count(severity)])),
    findings: presented.slice(0, LISTED),
    more: Math.max(0, presented.length - LISTED),
    skipped: report.skipped,
    ...(report.changes === undefined ? {} : { since_last_run: { new: report.changes.added, resolved: report.changes.resolved.slice(0, RESOLVED_LISTED), resolved_count: report.changes.resolved.length } }),
  }
}
