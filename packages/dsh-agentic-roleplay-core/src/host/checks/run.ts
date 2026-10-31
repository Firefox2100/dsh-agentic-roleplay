import { KITS, SEVERITIES, type CheckReport, type CheckSkipped as Skipped, type Finding, type KitId } from '../../shared/checks.ts'
import { CheckSkipped, type Check, type CheckInput } from './check.ts'
import { consistencyChecks } from './consistency.ts'
import { fidelityChecks } from './fidelity.ts'
import { playabilityChecks } from './playability.ts'
import { semanticChecks } from './semantic.ts'
import { qualityChecks } from './quality.ts'
import { recordResults } from './results.ts'

/** Every check of the suite, grouped by kit; the kits are the unit a command or a tool asks for. */
export const CHECKS: readonly Check[] = [...consistencyChecks, ...semanticChecks, ...fidelityChecks, ...qualityChecks, ...playabilityChecks]

export const checksOf = (kits: readonly KitId[], checks: readonly Check[] = CHECKS): Check[] => checks.filter(check => kits.includes(check.kit))

export interface Run {
  kits?: readonly KitId[]
  /** Only these checks, from the kits asked for. */
  ids?: readonly string[]
  /**
   * Also the checks a model judges; without it only those the program decides run, and the others are listed as skipped. `decision` runs only the yes-or-no checks a decision
   * model may answer, which are cheap enough to run unasked.
   */
  deep?: boolean | 'decision'
}

/**
 * Runs the checks asked for in order (a check that cannot run on this world, or lacks what it needs, is listed as skipped with the reason), stores what each found and
 * reports it with what changed since the checks last ran.
 */
export async function runChecks(given: CheckInput, run: Run = {}, checks: readonly Check[] = CHECKS, now: () => Date = () => new Date()): Promise<CheckReport> {
  const input: CheckInput = { ...given, memo: new Map() }
  const kits = run.kits ?? KITS
  const chosen = checksOf(kits, checks).filter(check => run.ids === undefined || run.ids.includes(check.id))
  const results: Record<string, Finding[]> = {}
  const skipped: Skipped[] = []
  for (const check of chosen) {
    if (check.mode !== 'code' && run.deep !== true && !(run.deep === 'decision' && check.mode === 'decision')) { skipped.push({ check: check.id, reason: 'judged by a model: ask for a deep check to run it' }); continue }
    const missing = check.needs.find(need => input[need] === undefined)
    if (missing !== undefined) { skipped.push({ check: check.id, reason: missing === 'card' ? 'the world has no card to compare with' : 'no model is available to judge' }); continue }
    try {
      results[check.id] = await check.run(input)
    } catch (error) {
      if (input.model?.cancelled?.() === true) throw error
      skipped.push({ check: check.id, reason: error instanceof CheckSkipped ? error.message : `it failed: ${error instanceof Error ? error.message : String(error)}` })
    }
  }
  const at = now().toISOString()
  const changes = await recordResults(input.world.directory, at, results)
  const findings = Object.values(results).flat().sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity))
  return { at, kits: [...kits], ran: Object.keys(results), skipped, findings, ...(changes === undefined ? {} : { changes }) }
}
