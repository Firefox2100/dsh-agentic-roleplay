import { roleplaySessionOf } from '../../shared/chat.ts'
import type { AiTracer, SpanHandle, SpanRef, SpanResult, SpanStart } from '@dsh-ai-providers/core'

export type { SpanHandle, SpanRef, SpanResult, SpanStart } from '@dsh-ai-providers/core'
export type Tracer = AiTracer

interface Lookup { get(name: 'aiTrace'): unknown }

export function tracerOf(ctx: unknown): Tracer | undefined {
  const found = (ctx as Lookup).get('aiTrace') as Partial<Tracer> | undefined
  return typeof found?.start === 'function' && typeof found.link === 'function' ? found as Tracer : undefined
}

const TAGS = ['roleplay']

/** Where a chat's work belongs in the trace: the story is the Langfuse session, so everything a story does is found under it. */
export const sessionOfChat = (chat: string): string => roleplaySessionOf(chat) ?? chat

/** A span for work with no turn around it (an autonomy tick, an off-stage round, a background job), filed under the story. */
export function startHelperSpan(tracer: Tracer, chat: string, start: Omit<SpanStart, 'trace' | 'parent'>): SpanHandle {
  const parent = tracer.linked(chat)
  return tracer.start({ ...start, parent, ...parent === undefined ? { trace: { name: start.name, sessionId: sessionOfChat(chat), tags: TAGS } } : {} })
}

/**
 * One trace per turn: its span is open from the game master's first step to the turn's end, linked to the chat so that the game master's
 * requests and every helper the turn starts nest under it.
 */
export class TurnTraces {
  private readonly open = new Map<string, { span: SpanHandle; unlink: () => void; output?: string }>()

  constructor(private readonly tracer: () => Tracer | undefined) {}

  begin(chat: string, turn: number, input: string): void {
    const tracer = this.tracer()
    if (tracer === undefined) return
    this.end(chat, { metadata: { ended: 'replaced by a later turn' } })
    const span = tracer.start({ name: `turn ${turn}`, kind: 'agent', input, metadata: { turn }, trace: { name: `turn ${turn}`, sessionId: sessionOfChat(chat), tags: TAGS } })
    this.open.set(chat, { span, unlink: tracer.link(chat, span.ref) })
  }

  of(chat: string): SpanRef | undefined {
    return this.open.get(chat)?.span.ref
  }

  /** What the player was shown, which becomes the output of the turn's trace. */
  output(chat: string, text: string): void {
    const held = this.open.get(chat)
    if (held !== undefined) held.output = text
  }

  /** A span for a piece of the turn (a round of characters), filed under it; absent when nothing is traced. */
  child(chat: string, start: Omit<SpanStart, 'trace' | 'parent'>): SpanHandle | undefined {
    const parent = this.open.get(chat)?.span.ref
    return parent === undefined ? undefined : this.tracer()?.start({ ...start, parent })
  }

  end(chat: string, result?: SpanResult): void {
    const held = this.open.get(chat)
    if (held === undefined) return
    this.open.delete(chat)
    held.unlink()
    held.span.end({ ...held.output === undefined ? {} : { output: held.output }, ...result })
  }
}
