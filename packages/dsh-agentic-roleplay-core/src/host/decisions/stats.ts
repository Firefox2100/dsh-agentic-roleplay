import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DECISION_SITES, MAX_SAMPLES, emptyStats, type DecisionSite, type DecisionStats, type SiteReport, type SiteStats } from '../../shared/decisions.ts'

export const DECISIONS_FILE = 'decisions.json'

const isSite = (value: unknown): value is SiteStats => typeof value === 'object' && value !== null
  && ['runs', 'items', 'decided', 'escalated', 'fallbacks', 'agreed', 'disagreed', 'decisionMs', 'llmMs'].every(field => typeof (value as Record<string, unknown>)[field] === 'number')
  && Array.isArray((value as SiteStats).samples)

/**
 * What was kept about the story's decisions. The file only holds measurements, so one that cannot be read is
 * started again, not a reason to stop the story.
 */
export function readDecisionStats(folder: string, now: () => Date = () => new Date()): DecisionStats {
  let value: unknown
  try { value = JSON.parse(readFileSync(join(folder, DECISIONS_FILE), 'utf8')) } catch { return emptyStats(now().toISOString()) }
  const given = value as Partial<DecisionStats> | null
  const fresh = emptyStats(typeof given?.since === 'string' ? given.since : now().toISOString())
  for (const site of DECISION_SITES) {
    const entry = given?.sites?.[site]
    if (isSite(entry)) fresh.sites[site] = entry
  }
  return fresh
}

/** Adds one run of a site to what is kept; the file is written aside and renamed, and stays beside the database, so putting the story back does not change it. */
export function recordDecisions(folder: string, site: DecisionSite, report: SiteReport, now: () => Date = () => new Date()): void {
  const stats = readDecisionStats(folder, now)
  const kept = stats.sites[site]
  stats.sites[site] = {
    runs: kept.runs + 1,
    items: kept.items + report.items,
    decided: kept.decided + report.decided,
    escalated: kept.escalated + report.escalated,
    fallbacks: kept.fallbacks + report.fallbacks,
    agreed: kept.agreed + report.agreed,
    disagreed: kept.disagreed + report.disagreed,
    decisionMs: kept.decisionMs + report.decisionMs,
    llmMs: kept.llmMs + report.llmMs,
    samples: [...kept.samples, ...report.samples].slice(-MAX_SAMPLES),
    ...report.problem === undefined ? {} : { problem: report.problem },
  }
  const target = join(folder, DECISIONS_FILE)
  const aside = `${target}.writing`
  writeFileSync(aside, JSON.stringify(stats, null, 2))
  renameSync(aside, target)
}
