import type { LogRow } from './helper-logs.ts'

/** One call an assistant made, with how it ended. */
export interface ToolCall {
  name: string
  args: Record<string, unknown>
  error: boolean
}

const record = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {})

/** The calls of a session log in order, each with whether it failed (a result with `isError`, which includes a call the harness or the person refused). */
export function toolCallsOf(rows: readonly LogRow[]): ToolCall[] {
  const calls: ToolCall[] = []
  const byId = new Map<string, ToolCall>()
  for (const row of rows) {
    const data = record(row.data)
    if (row.type === 'tool/call') {
      const raw = data['arguments']
      let args: Record<string, unknown> = {}
      if (typeof raw === 'string') { try { args = record(JSON.parse(raw)) } catch { args = {} } } else args = record(raw)
      const call: ToolCall = { name: String(data['name'] ?? ''), args, error: false }
      calls.push(call)
      byId.set(String(data['callId']), call)
    } else if (row.type === 'tool/result') {
      const message = record(data['message'])
      const call = byId.get(String(message['toolCallId']))
      if (call !== undefined && message['isError'] === true) call.error = true
    }
  }
  return calls
}

/** The tools that write a world, with the guide each needs and the guide's name for the kind it was given. */
const GUIDE_OF: Record<string, (args: Record<string, unknown>) => string | undefined> = {
  create_world_element: args => ({ character: 'world-characters', location: 'world-places', item: 'world-items', faction: 'world-factions', lore: 'world-lore' } as Record<string, string>)[String(args['kind'])],
  replace_world_element: args => ({ character: 'world-characters', location: 'world-places', item: 'world-items', faction: 'world-factions', lore: 'world-lore' } as Record<string, string>)[String(args['kind'])],
  update_world_element: args => ({ character: 'world-characters', location: 'world-places', item: 'world-items', faction: 'world-factions', lore: 'world-lore' } as Record<string, string>)[String(args['kind'])],
  write_world_trigger: () => 'world-triggers',
  update_world_trigger: () => 'world-triggers',
  replace_world_plots: () => 'world-plots',
  update_world_plot: () => 'world-plots',
  write_world_file: args => ({ variables: 'world-variables', dice: 'world-dice', commands: 'world-commands', calendar: 'world-calendar' } as Record<string, string>)[String(args['kind'])],
  update_world_file: args => ({ variables: 'world-variables', dice: 'world-dice', commands: 'world-commands', calendar: 'world-calendar' } as Record<string, string>)[String(args['kind'])],
  edit_world_info: () => 'world-info',
}

/** What a run's calls add up to. */
export interface ToolMetrics {
  calls: number
  failed: number
  /** The most failed calls in a row. */
  longestFailureRun: number
  /** Writes whose guide was not loaded before the first write that needs it, by guide. */
  guidesSkipped: string[]
  /** A kind removed and made again under the same key, or a relationship removed and made again: a change made by delete and re-add. */
  churn: number
  /** Whole-document writes, and writes of only the changed fields. */
  whole: number
  partial: number
  /** Calls made with exactly the arguments of an earlier call. */
  repeated: number
}

const WHOLE = new Set(['replace_world_element', 'replace_world_plots', 'write_world_trigger', 'write_world_file'])
const PARTIAL = new Set(['update_world_element', 'update_world_plot', 'update_world_trigger', 'update_world_file'])

export function toolMetrics(calls: readonly ToolCall[]): ToolMetrics {
  let run = 0
  let longest = 0
  const loaded = new Set<string>()
  const skipped = new Set<string>()
  const seen = new Set<string>()
  let repeated = 0
  let churn = 0
  const removed = new Set<string>()
  for (const call of calls) {
    if (call.error) { run += 1; longest = Math.max(longest, run) } else run = 0
    const signature = `${call.name}:${JSON.stringify(call.args)}`
    if (seen.has(signature)) repeated += 1
    seen.add(signature)
    if (call.name === 'skill' && typeof call.args['name'] === 'string') loaded.add(call.args['name'])
    const guide = GUIDE_OF[call.name]?.(call.args)
    if (guide !== undefined && !loaded.has(guide)) skipped.add(guide)
    const identity = `${String(call.args['kind'] ?? '')}:${String(call.args['key'] ?? '')}`
    if (call.name === 'delete_world_element' && !call.error) removed.add(identity)
    if (call.name === 'create_world_element' && removed.has(identity)) churn += 1
    const change = record(call.args['change'])
    if (call.name === 'edit_world_relationship' && !call.error) {
      const relation = `${String(change['kind'] ?? '')}:${String(change['from'] ?? '')}:${String(change['to'] ?? '')}`
      if (change['remove'] === true) removed.add(`relation:${String(change['key'] ?? '')}`)
      else if (change['create'] === true && [...removed].some(entry => entry.startsWith('relation:') && relation.split(':').slice(1).every(part => entry.includes(part)))) churn += 1
    }
  }
  return {
    calls: calls.length, failed: calls.filter(call => call.error).length, longestFailureRun: longest, guidesSkipped: [...skipped], churn,
    whole: calls.filter(call => WHOLE.has(call.name)).length, partial: calls.filter(call => PARTIAL.has(call.name)).length, repeated,
  }
}

/** What a case holds the assistant's use of its tools to; the vocabulary is closed. */
export type ToolExpect =
  | { type: 'not-used'; tool: string }
  | { type: 'used-any'; tools: string[] }
  | { type: 'guide-first'; guide: string }
  | { type: 'max-failures'; n: number }
  | { type: 'no-churn' }

/** Why the calls do not meet what the case expects; empty when they do. */
export function toolProblems(expect: readonly ToolExpect[], calls: readonly ToolCall[]): string[] {
  const metrics = toolMetrics(calls)
  const problems: string[] = []
  for (const wanted of expect) {
    switch (wanted.type) {
      case 'not-used': if (calls.some(call => call.name === wanted.tool && !call.error)) problems.push(`${wanted.tool} was used`); break
      case 'used-any': if (!calls.some(call => wanted.tools.includes(call.name) && !call.error)) problems.push(`none of ${wanted.tools.join(', ')} was used`); break
      case 'guide-first': if (metrics.guidesSkipped.includes(wanted.guide)) problems.push(`${wanted.guide} was not loaded before the first write that needs it`); break
      case 'max-failures': if (metrics.failed > wanted.n) problems.push(`${metrics.failed} calls failed, more than ${wanted.n}`); break
      case 'no-churn': if (metrics.churn > 0) problems.push('something was deleted and made again to change it'); break
    }
  }
  return problems
}
