import type { ActivityEntry } from '../../shared/activity.ts'
import type { PromptPart, TurnTrace } from '../../shared/trace.ts'

/** What one helper's runs for a turn took before the output was delivered, which the player waited for, and after it. */
export interface HelperTime {
  label: string
  foregroundMs: number
  backgroundMs: number
  runs: number
  refused: number
}

export interface TurnTimes {
  /** From the start of the turn until the output was delivered. */
  foregroundMs: number
  /** The wait before the game master's first request. */
  beforeMs: number
  /** The game master's own requests. */
  modelMs: number
  /** Tool calls by how long they took, longest first: the characters' round is inside `activate_characters`. */
  tools: { tool: string; ms: number; calls: number }[]
  helpers: HelperTime[]
  /** From delivery until the last helper of the turn ended; 0 when none ran on. */
  backgroundMs: number
}

/**
 * Where a turn's time went. A helper's run is counted for the turn it was working for (the one the game master had begun when it ended), and the part of it that fell after
 * delivery is background. A background run that ends after the next turn began is counted for that turn instead.
 */
export function turnTimes(trace: TurnTrace, activity: readonly ActivityEntry[]): TurnTimes {
  const delivered = trace.endedAt
  const byTool = new Map<string, { ms: number; calls: number }>()
  for (const call of trace.calls ?? []) {
    const entry = byTool.get(call.tool) ?? { ms: 0, calls: 0 }
    byTool.set(call.tool, { ms: entry.ms + (call.ms ?? 0), calls: entry.calls + 1 })
  }
  const helpers = new Map<string, HelperTime>()
  let lastEnd = delivered ?? 0
  for (const entry of activity.filter(run => run.turn === trace.turn)) {
    const start = entry.at - entry.ms
    const before = delivered === undefined ? entry.ms : Math.max(0, Math.min(entry.at, delivered) - Math.max(start, trace.startedAt))
    const after = delivered === undefined ? 0 : Math.max(0, entry.at - Math.max(start, delivered))
    if (after > 0) lastEnd = Math.max(lastEnd, entry.at)
    const current = helpers.get(entry.label) ?? { label: entry.label, foregroundMs: 0, backgroundMs: 0, runs: 0, refused: 0 }
    helpers.set(entry.label, { ...current, foregroundMs: current.foregroundMs + before, backgroundMs: current.backgroundMs + after, runs: current.runs + 1, refused: current.refused + (entry.refused ?? 0) })
  }
  return {
    foregroundMs: delivered === undefined ? 0 : Math.max(0, delivered - trace.startedAt),
    beforeMs: trace.beforeMs ?? 0,
    modelMs: (trace.requests ?? []).reduce((sum, request) => sum + (request.ms ?? 0), 0),
    tools: [...byTool].map(([tool, value]) => ({ tool, ...value })).sort((a, b) => b.ms - a.ms),
    helpers: [...helpers.values()].sort((a, b) => b.foregroundMs + b.backgroundMs - a.foregroundMs - a.backgroundMs),
    backgroundMs: delivered === undefined ? 0 : Math.max(0, lastEnd - delivered),
  }
}

/** The request with the biggest prompt, where the game master's context stood at its fullest, with its parts largest first. */
export function fullestRequest(trace: TurnTrace): { prompt?: number; parts: PromptPart[]; step: number } | undefined {
  const sized = (trace.requests ?? []).filter(request => request.parts !== undefined)
  if (sized.length === 0) return undefined
  const fullest = sized.reduce((best, request) => ((request.prompt ?? 0) > (best.prompt ?? 0) ? request : best))
  return { ...fullest.prompt === undefined ? {} : { prompt: fullest.prompt }, step: fullest.step, parts: [...fullest.parts ?? []].sort((a, b) => b.tokens - a.tokens) }
}

/** The tools whose answers are what the game master looked up, as opposed to what it did. */
export const LOOKUP_TOOLS: readonly string[] = ['search_lore', 'search_events', 'recall_memories', 'list_threads', 'list_characters', 'get_character', 'list_relationships', 'list_items', 'get_item', 'list_locations', 'get_location', 'get_agenda', 'search_images', 'preview_scene']

/** Everything the harness refused or steered in a turn: the game master's refused calls and its own messages, and the runs of helpers with refused calls. */
export function refusalsOf(trace: TurnTrace, helpers: readonly HelperTime[]): { calls: { tool: string; note: string }[]; steered: string[]; helpers: { label: string; refused: number }[]; cutOff: number[] } {
  return {
    calls: (trace.calls ?? []).filter(call => call.failed).map(call => ({ tool: call.tool, note: call.note })),
    steered: trace.steered ?? [],
    helpers: helpers.filter(helper => helper.refused > 0).map(helper => ({ label: helper.label, refused: helper.refused })),
    cutOff: (trace.requests ?? []).filter(request => request.stop === 'max-tokens').map(request => request.step),
  }
}
