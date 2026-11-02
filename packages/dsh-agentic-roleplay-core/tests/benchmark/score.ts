import type { Finding } from '../../src/shared/checks.ts'
import type { BenchCase, Expect } from './cases.ts'
import { BASELINE, matches } from './cases.ts'

/** How one case came out. A finding is a true positive when the case expected it, a false positive when nothing excused it, and an expected finding that did not come is a miss. */
export interface Scored {
  tp: Expect[]
  fn: Expect[]
  fp: { check: string; code: string; where: string; message: string }[]
  /** Findings that were neither expected nor refused: the case allowed them. */
  tolerated: number
}

export function score(benchmark: BenchCase, findings: readonly Finding[]): Scored {
  const allowed = [...benchmark.card === undefined ? BASELINE : [], ...benchmark.allowed ?? []]
  const tp = benchmark.expect.filter(want => findings.some(finding => matches(finding, want)))
  const fn = benchmark.expect.filter(want => !findings.some(finding => matches(finding, want)))
  const extra = findings.filter(finding => !benchmark.expect.some(want => matches(finding, want)))
  // what a model names as missing from a world is open-ended: a gap it names that the case did not plant is counted as noise, not as a false alarm
  const fp = extra.filter(finding => finding.check !== 'world-gaps' && !allowed.some(ok => matches(finding, ok)))
  return { tp, fn, fp: fp.map(finding => ({ check: finding.check, code: finding.code, where: finding.where, message: finding.message.slice(0, 300) })), tolerated: extra.length - fp.length }
}

export interface Totals { tp: number; fn: number; fp: number; cases: number; passed: number }
export const NONE: Totals = { tp: 0, fn: 0, fp: 0, cases: 0, passed: 0 }

export function add(totals: Totals, scored: Scored): Totals {
  return { tp: totals.tp + scored.tp.length, fn: totals.fn + scored.fn.length, fp: totals.fp + scored.fp.length, cases: totals.cases + 1, passed: totals.passed + (scored.fn.length === 0 && scored.fp.length === 0 ? 1 : 0) }
}

/** Precision and recall, or nothing when there was nothing to find or nothing found (a ratio of zero by zero says nothing). */
export const precision = (totals: Totals): number | undefined => (totals.tp + totals.fp === 0 ? undefined : totals.tp / (totals.tp + totals.fp))
export const recall = (totals: Totals): number | undefined => (totals.tp + totals.fn === 0 ? undefined : totals.tp / (totals.tp + totals.fn))
