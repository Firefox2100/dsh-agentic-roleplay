import type { SiteStats } from '../../shared/decisions.ts'

/** The average time of a run, or a dash when the site has not run. */
export const perRun = (total: number, runs: number): string => (runs === 0 ? '–' : `${Math.round(total / runs)} ms`)

/** The share of compared judgements that the decision model made the way the language model did, or a dash when none were compared. */
export const agreement = (stats: Pick<SiteStats, 'agreed' | 'disagreed'>): string => (stats.agreed + stats.disagreed === 0 ? '–' : `${Math.round((100 * stats.agreed) / (stats.agreed + stats.disagreed))}%`)
