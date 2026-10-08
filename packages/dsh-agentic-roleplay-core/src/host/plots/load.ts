import { join } from 'node:path'
import { PLOT_NUDGE_MODES, PLOT_STATUSES, type PlotDefinition, type PlotDevelopment } from 'dsh-roleplay-model'
import type { WorldProblem } from '../../shared/worlds.ts'
import { errorMessage } from '../errors.ts'
import { readDocument } from '../read-document.ts'
import { Reader, type Issue, type ParseResult } from '../validation.ts'

export const PLOTS_FILE_NAME = 'plots.json'

function development(reader: Reader, fallback: string): PlotDevelopment {
  return {
    id: reader.string('id') ?? fallback,
    text: reader.string('text', { required: true }) ?? '',
    mode: reader.oneOf('mode', PLOT_NUDGE_MODES, 'opportunity'),
    prerequisites: reader.strings('prerequisites'),
    guidance: reader.text('guidance'),
    avoid: reader.strings('avoid'),
  }
}

/** Parse the optional world-level list of dramatic possibilities. */
export function parsePlotsFile(text: string): ParseResult<PlotDefinition[]> {
  const issues: Issue[] = []
  const wrapper = Reader.fromJson(`{"plots":${text.replace(/^﻿/, '')}}`, issues)
  if (wrapper === undefined) return { ok: false, issues }
  const plots = wrapper.objects('plots').map((reader, plotIndex): PlotDefinition => {
    const pacing = reader.object('pacing')
    const hooks = reader.objects('hooks').map((entry, index) => development(entry, `hook-${index + 1}`))
    const developments = reader.objects('developments').map((entry, index) => development(entry, `development-${index + 1}`))
    return {
      id: reader.string('id', { required: true }) ?? `plot-${plotIndex + 1}`,
      name: reader.string('name', { required: true }) ?? '',
      premise: reader.string('premise', { required: true }) ?? '',
      themes: reader.strings('themes'), hooks, developments,
      stakes: reader.strings('stakes'), resolutions: reader.strings('resolutions'), participants: reader.strings('participants'),
      start: reader.oneOf('start', PLOT_STATUSES, 'available'),
      pacing: {
        quietTurns: pacing?.number('quiet_turns', { min: 1, max: 20 }) ?? pacing?.number('quietTurns', { min: 1, max: 20 }) ?? 3,
        cooldownTurns: pacing?.number('cooldown_turns', { min: 1, max: 50 }) ?? pacing?.number('cooldownTurns', { min: 1, max: 50 }) ?? 4,
        cooldownDays: pacing?.number('cooldown_days', { min: 0, max: 365 }) ?? pacing?.number('cooldownDays', { min: 0, max: 365 }) ?? 1,
      },
    }
  })
  const ids = plots.map(plot => plot.id)
  ids.forEach((id, index) => { if (ids.indexOf(id) !== index) issues.push({ path: `plots[${index}].id`, message: `plot id "${id}" is defined twice` }) })
  for (const [plotIndex, plot] of plots.entries()) {
    const steps = [...plot.hooks, ...plot.developments]
    const stepIds = steps.map(step => step.id)
    stepIds.forEach((id, index) => { if (stepIds.indexOf(id) !== index) issues.push({ path: `plots[${plotIndex}]`, message: `development id "${id}" is defined twice` }) })
    for (const step of steps) for (const required of step.prerequisites) if (!stepIds.includes(required)) issues.push({ path: `plots[${plotIndex}]`, message: `development "${step.id}" requires unknown development "${required}"` })
  }
  return issues.length === 0 ? { ok: true, value: plots } : { ok: false, issues }
}

export async function loadPlots(worldDir: string): Promise<{ plots: PlotDefinition[]; problems: WorldProblem[] }> {
  const result: { plots: PlotDefinition[]; problems: WorldProblem[] } = { plots: [], problems: [] }
  const file = join(worldDir, PLOTS_FILE_NAME)
  try { result.plots = (await readDocument(file, parsePlotsFile, result.problems)) ?? [] } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') result.problems.push({ path: file, message: errorMessage(error) })
  }
  return result
}

export function plotReferenceProblems(plots: readonly PlotDefinition[], entities: readonly string[]): string[] {
  const known = new Set(entities)
  return plots.flatMap(plot => plot.participants.filter(participant => !known.has(participant)).map(participant => `plot "${plot.id}" names unknown participant "${participant}"`))
}
