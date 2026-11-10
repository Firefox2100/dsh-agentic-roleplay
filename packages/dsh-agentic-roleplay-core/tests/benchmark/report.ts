import type { RowRun } from './rows-run.ts'

/** How often expectations of one kind held, failed or could not be judged. */
export interface Tally {
  held: number
  failed: number
  unjudged: number
}

export interface KindRow extends Tally {
  kind: string
  language: string
  theme: string
}

export interface Flaky {
  row: string
  where: string
  expectation: string
  held: number
  failed: number
}

const empty = (): Tally => ({ held: 0, failed: 0, unjudged: 0 })
const add = (tally: Tally, held: boolean | undefined): void => { if (held === undefined) tally.unjudged += 1; else if (held) tally.held += 1; else tally.failed += 1 }
const label = (expectation: object): string => Object.entries(expectation).map(([key, value]) => (key === 'type' ? String(value) : `${key}=${String(value)}`)).join(' ')

/**
 * What the runs add up to by kind of expectation, language and theme: planted rows are left out (their failures are what they are for). Reported apart per cell,
 * never averaged across languages or themes.
 */
export function byKind(results: readonly RowRun[], themeOf: (row: string) => string): KindRow[] {
  const cells = new Map<string, KindRow>()
  for (const result of results) {
    if (result.planted !== undefined) continue
    for (const verdict of result.verdicts) {
      const key = `${verdict.expectation.type}|${result.language}|${themeOf(result.row)}`
      const cell = cells.get(key) ?? { kind: verdict.expectation.type, language: result.language, theme: themeOf(result.row), ...empty() }
      add(cell, verdict.held)
      cells.set(key, cell)
    }
  }
  return [...cells.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.language.localeCompare(b.language) || a.theme.localeCompare(b.theme))
}

/** The expectations of a row that held in some repeats and failed in others: the ones a single pass cannot be trusted on. Only repeated rows can show one. */
export function flaky(results: readonly RowRun[]): Flaky[] {
  const seen = new Map<string, Flaky>()
  for (const result of results) {
    if (result.planted !== undefined) continue
    for (const verdict of result.verdicts) {
      if (verdict.held === undefined) continue
      const key = `${result.row}|${verdict.where}|${label(verdict.expectation)}`
      const entry = seen.get(key) ?? { row: result.row, where: verdict.where, expectation: label(verdict.expectation), held: 0, failed: 0 }
      if (verdict.held) entry.held += 1
      else entry.failed += 1
      seen.set(key, entry)
    }
  }
  return [...seen.values()].filter(entry => entry.held > 0 && entry.failed > 0)
}

/** The kinds as lines of text, one per kind, language and theme, with the share that held among those judged. */
export function describeKinds(rows: readonly KindRow[]): string[] {
  return rows.map((row) => {
    const judged = row.held + row.failed
    return `${row.kind.padEnd(20)} ${row.language}  ${row.theme.padEnd(8)} ${judged === 0 ? 'n/a' : `${Math.round((100 * row.held) / judged)}%`.padStart(4)}  (${row.held}/${judged}${row.unjudged > 0 ? `, ${row.unjudged} not judged` : ''})`
  })
}
