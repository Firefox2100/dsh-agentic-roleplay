import type { JsonValue, PlotDefinition, PlotProgress } from 'dsh-roleplay-model'
import type { TurnStore } from '../orchestration/boundaries.ts'

export const PLOTS_METADATA_KEY = 'roleplay.pacing.plots'

export interface PacingAdvice {
  need: 'gentle' | 'clear'
  reason: string
  plot: string
  plotName: string
  development: string
  mode: string
  guidance: string
  avoid: string[]
}

export function populatePlots(metadata: TurnStore['story']['metadata'], plots: readonly PlotDefinition[]): void {
  const progress: PlotProgress[] = plots.map(plot => ({ plot, status: plot.start, introduced: [], rejected: [], lastNudgeTurn: 0 }))
  metadata.setValue(PLOTS_METADATA_KEY, progress as unknown as JsonValue)
}

export function addSessionPlot(store: TurnStore, plot: PlotDefinition): void {
  const plots = progressOf(store)
  if (plots.some(entry => entry.plot.id === plot.id)) throw new Error(`there is already a plot "${plot.id}"`)
  plots.push({ plot, status: plot.start, introduced: [], rejected: [], lastNudgeTurn: 0 })
  store.story.metadata.setValue(PLOTS_METADATA_KEY, plots as unknown as JsonValue)
}

export function plotAuthorNeeded(store: TurnStore, turn: number): boolean {
  if (progressOf(store).length > 0 || turn < 5) return false
  return store.story.events.list({ fromTurn: Math.max(1, turn - 2), toTurn: turn - 1 }).length === 0 && store.story.threads.list('open').length === 0
}

export function plotProgressOf(metadata: TurnStore['story']['metadata']): PlotProgress[] {
  const value = metadata.getValue(PLOTS_METADATA_KEY)
  return Array.isArray(value) ? value as unknown as PlotProgress[] : []
}

function progressOf(store: TurnStore): PlotProgress[] {
  return plotProgressOf(store.story.metadata)
}

/** Select one uncommitted possibility when the story has genuinely gone quiet; selection never makes it happen. */
export function pacingAdvice(store: TurnStore, turn: number): PacingAdvice | undefined {
  const plots = progressOf(store)
  if (plots.length === 0) return undefined
  const now = store.story.clock.get()?.now
  const recent = store.story.events.list({ fromTurn: Math.max(1, turn - 2), toTurn: turn - 1 })
  const openThreads = store.story.threads.list('open')
  for (const progress of plots) {
    if (!['available', 'engaged', 'cooling'].includes(progress.status)) continue
    const quietTurns = progress.plot.pacing.quietTurns + (openThreads.length === 0 ? 0 : 2)
    if (recent.length > 0 || turn <= quietTurns) continue
    if (turn - progress.lastNudgeTurn < progress.plot.pacing.cooldownTurns) continue
    if (now !== undefined && progress.lastNudgeAt !== undefined && now - progress.lastNudgeAt < progress.plot.pacing.cooldownDays * 86_400_000) continue
    const candidates = [...progress.plot.hooks, ...progress.plot.developments].filter(step => !progress.introduced.includes(step.id) && !progress.rejected.includes(step.id) && step.prerequisites.every(id => progress.introduced.includes(id)))
    const step = candidates[0]
    if (step === undefined) continue
    const quietFor = turn - progress.lastNudgeTurn
    progress.lastNudgeTurn = turn
    if (now !== undefined) progress.lastNudgeAt = now
    progress.status = progress.status === 'available' ? 'engaged' : progress.status
    store.story.metadata.setValue(PLOTS_METADATA_KEY, plots as unknown as JsonValue)
    return {
      need: quietFor > progress.plot.pacing.quietTurns * 2 ? 'clear' : 'gentle',
      reason: openThreads.length === 0 ? 'no recorded development or immediate thread has guided the last few turns' : 'the open threads have remained without recorded development for several turns',
      plot: progress.plot.id, plotName: progress.plot.name, development: step.id, mode: step.mode,
      guidance: step.guidance || step.text, avoid: step.avoid,
    }
  }
  return undefined
}

export function describePacingAdvice(advice: PacingAdvice): string {
  return `Pacing opportunity (${advice.need}; advice only, not an event): ${advice.plotName} [plot ${advice.plot}] / development ${advice.development}\nWhy now: ${advice.reason}.\nPossible nudge (${advice.mode}): ${advice.guidance}${advice.avoid.length === 0 ? '' : `\nDo not: ${advice.avoid.join('; ')}.`}\nUse it only if it fits the present scene. Do not make the player accept it, do not make a character act without activate_characters, and do not mark the development complete merely because it was offered.`
}

export function updatePlotProgress(store: TurnStore, plotId: string, developmentId: string | undefined, action: 'introduced' | 'rejected' | 'resolved' | 'abandoned'): PlotProgress {
  const plots = progressOf(store)
  const progress = plots.find(entry => entry.plot.id === plotId)
  if (progress === undefined) throw new Error(`there is no plot "${plotId}"`)
  if (action === 'resolved' || action === 'abandoned') progress.status = action
  else {
    if (developmentId === undefined) throw new Error(`${action} needs a development`)
    const known = [...progress.plot.hooks, ...progress.plot.developments].some(step => step.id === developmentId)
    if (!known) throw new Error(`plot "${plotId}" has no development "${developmentId}"`)
    const target = action === 'introduced' ? progress.introduced : progress.rejected
    if (!target.includes(developmentId)) target.push(developmentId)
    if (action === 'introduced') progress.status = 'engaged'
  }
  store.story.metadata.setValue(PLOTS_METADATA_KEY, plots as unknown as JsonValue)
  return progress
}
