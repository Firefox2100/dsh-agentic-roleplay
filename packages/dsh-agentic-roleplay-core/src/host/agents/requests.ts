import { MAX_REQUESTS, type RequestStat } from '../../shared/diagnostics.ts'
import type { PromptPart } from '../../shared/trace.ts'
import { estimateTokens, messageTokens } from '../diagnostics/estimate.ts'

interface Logged { type: string; time?: number; data?: unknown }
interface Chunked { type: string; time?: number; chunk?: { type: string; usage?: Usage; reason?: { kind?: string } } }
interface Usage { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number }

type Held = Record<'system' | 'tools' | 'notices' | 'input' | 'steps', number>

/** What a request's prompt was made of: the parts the log shows, and whatever else the service counted (the earlier turns of the conversation). */
function parts(held: Held, prompt: number | undefined): { parts?: PromptPart[] } {
  const known = (Object.keys(held) as (keyof Held)[]).filter(id => held[id] > 0).map(id => ({ id, tokens: held[id] }))
  const rest = prompt === undefined ? 0 : prompt - known.reduce((sum, part) => sum + part.tokens, 0)
  const all = rest > 0 ? [...known, { id: 'earlier', tokens: rest }] : known
  return all.length === 0 ? {} : { parts: all }
}

const KEEP_WAITING = new Set(['block-start', 'text-delta', 'reasoning-delta'])

/**
 * The requests a session's events record, in order. The wait is measured from the start of the step to the first block the model opened;
 * whatever DSH took to assemble the request is in it, which is small beside a model's own time to read the prompt.
 */
export function requestsOf(events: readonly Logged[]): RequestStat[] {
  const stats: RequestStat[] = []
  const began = new Map<string, number>()
  const held = { system: 0, tools: 0, notices: 0, input: 0, steps: 0 }
  for (const event of events) {
    const data = event.data as { turn?: number; step?: number; stream?: readonly Chunked[]; usage?: Usage; message?: unknown; source?: { kind?: string }; header?: { tools?: unknown } } | undefined
    const key = `${data?.turn ?? 0}:${data?.step ?? 0}`
    if (event.type === 'step/start' && event.time !== undefined) began.set(key, event.time)
    if (event.type === 'turn/start') held.notices = held.input = held.steps = 0
    if (event.type === 'system/message') held.system = messageTokens(data?.message)
    if (event.type === 'request/header') held.tools = estimateTokens(JSON.stringify(data?.header?.tools ?? []))
    if (event.type === 'user/message') held[data?.source?.kind === 'roleplay' ? 'notices' : 'input'] += messageTokens(data)
    if (event.type === 'tool/result') held.steps += messageTokens(data?.message)
    if (event.type !== 'assistant/message') continue
    const sent = { ...held }
    if (data?.message !== undefined) held.steps += messageTokens(data.message)
    if (data?.stream === undefined || stats.length >= MAX_REQUESTS) continue
    const start = began.get(key)
    const chunks = data.stream.flatMap(entry => (entry.chunk === undefined ? [] : [{ time: entry.time, chunk: entry.chunk }]))
    const usage = chunks.findLast(entry => entry.chunk.type === 'usage')?.chunk.usage ?? data.usage
    const first = chunks.find(entry => KEEP_WAITING.has(entry.chunk.type))?.time
    const stop = chunks.findLast(entry => entry.chunk.type === 'finish')?.chunk.reason?.kind ?? 'stop'
    const cached = usage?.cacheReadTokens
    const prompt = usage?.inputTokens === undefined ? undefined : usage.inputTokens + (cached ?? 0) + (usage.cacheWriteTokens ?? 0)
    stats.push({
      step: data.step ?? 0,
      ...prompt === undefined ? {} : { prompt },
      ...usage?.outputTokens === undefined ? {} : { output: usage.outputTokens },
      ...cached === undefined ? {} : { cached },
      ...start === undefined || first === undefined ? {} : { waitMs: Math.max(0, first - start) },
      ...start === undefined || event.time === undefined ? {} : { ms: Math.max(0, event.time - start) },
      stop,
      ...parts(sent, prompt),
    })
  }
  return stats
}
