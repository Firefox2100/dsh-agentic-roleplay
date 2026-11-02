import { MAX_TRACE_CALLS, MAX_TRACE_NOTE, MAX_TRACE_STEERED, type MasterCall, type TurnTrace } from '../../shared/trace.ts'
import { requestsOf } from '../agents/requests.ts'
import { blockText } from './estimate.ts'

interface Logged { type: string; time?: number; data?: unknown }
interface Message { content?: unknown; source?: { kind?: string }; isError?: boolean; toolCallId?: string }

const cut = (text: string): string => (text.length > MAX_TRACE_NOTE ? `${text.slice(0, MAX_TRACE_NOTE)}…` : text)
const textOf = (message: Message | undefined): string => (Array.isArray(message?.content) ? message.content.map(blockText).join('') : typeof message?.content === 'string' ? message.content : '')

/**
 * What the chat's log says of one turn of the game master: how long it waited before its first request, each request with the parts of its prompt, each tool call with its time and the
 * reason when it was refused, and what the harness said to it to keep the turn going. `events` are those from the turn's start to its end.
 */
export function masterTrace(events: readonly Logged[]): Pick<TurnTrace, 'startedAt' | 'endedAt' | 'beforeMs' | 'requests' | 'calls' | 'steered'> {
  const start = events.find(event => event.type === 'turn/start')
  const end = events.findLast(event => event.type === 'turn/end')
  const first = events.find(event => event.type === 'step/start')
  const pending = new Map<string, { tool: string; at: number }>()
  const calls: MasterCall[] = []
  const steered: string[] = []
  let answered = false
  for (const event of events) {
    const data = event.data as { callId?: string; name?: string; message?: Message } & Message | undefined
    if (event.type === 'assistant/message') answered = true
    else if (event.type === 'tool/call' && data?.callId !== undefined && data.name !== undefined) pending.set(data.callId, { tool: data.name, at: event.time ?? 0 })
    else if (event.type === 'tool/result') {
      const message = data?.message
      const call = message?.toolCallId === undefined ? undefined : pending.get(message.toolCallId)
      if (call !== undefined && calls.length < MAX_TRACE_CALLS) calls.push({ tool: call.tool, ...event.time === undefined ? {} : { ms: Math.max(0, event.time - call.at) }, failed: message?.isError === true, note: cut(textOf(message)) })
    } else if (event.type === 'user/message' && answered && data?.source?.kind === 'roleplay' && steered.length < MAX_TRACE_STEERED) steered.push(cut(textOf(data)))
  }
  const requests = requestsOf(events)
  return {
    startedAt: start?.time ?? 0,
    ...end?.time === undefined ? {} : { endedAt: end.time },
    ...start?.time === undefined || first?.time === undefined ? {} : { beforeMs: Math.max(0, first.time - start.time) },
    ...requests.length === 0 ? {} : { requests },
    ...calls.length === 0 ? {} : { calls },
    ...steered.length === 0 ? {} : { steered },
  }
}
