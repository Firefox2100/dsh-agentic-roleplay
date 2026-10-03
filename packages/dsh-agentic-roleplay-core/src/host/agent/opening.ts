import { createMessage, createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session'
import { encodeOutput, type NarrationSegment } from '../../shared/narration.ts'

/** What the opening is reported to come from, where a chat shows the source of a message. */
export const OPENING_SOURCE = { provider: 'roleplay', model: 'opening' } as const

const NARRATE_TOOL = 'narrate'

/** The slice of DSH's session persistence used to store a chat before its agent exists. */
export interface SessionPersistenceLike {
  create(header: SessionHeader): Promise<{
    append(events: readonly SessionEvent[]): Promise<unknown>
    flush(): Promise<unknown>
    close(): Promise<void>
  }>
}

/**
 * The log of a chat that opens with a story: a finished first turn in which the
 * output was delivered the way every later turn delivers it (a `narrate` call and
 * its result), so it renders the same and the model reads a history that looks like
 * the one it will write. The player's message starts the second turn. Nothing is
 * asked of a model.
 */
export function openingEvents(segments: readonly NarrationSegment[]): readonly SessionEvent[] {
  const session = Session.create(SessionId('opening'))
  const turn = 1
  const step = 1
  const callId = ToolCallId('opening-narrate')
  const sent = segments.map(segment => (segment.type === 'utterance'
    ? { type: 'utterance', character: segment.character, text: segment.text }
    : { type: 'narration', text: segment.text }))
  const args = JSON.stringify({ segments: sent })

  session.append('turn/start', { turn })
  session.append('step/start', { turn, step })
  session.append('assistant/message', {
    stream: [],
    turn,
    step,
    message: createMessage({
      role: 'assistant',
      content: [{ type: 'tool-call', id: callId, name: NARRATE_TOOL, arguments: args }],
      source: { kind: 'model', ...OPENING_SOURCE },
    }),
  }, { surfaceOp: 'append' })
  const call = session.append('tool/call', { turn, step, callId, name: NARRATE_TOOL, arguments: args })
  session.append('tool/result', {
    turn,
    step,
    message: createToolResultMessage({
      callId,
      content: [{ type: 'text', text: `The output has been delivered to the player. The turn ends here.\n${encodeOutput({ segments: [...segments], repaired: false })}` }],
      isError: false,
    }),
  }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
  session.append('step/end', { turn, step })
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
  return session.snapshotEvents()
}

/**
 * Store a chat that already holds its opening, before any agent exists for it.
 * The agent loop reads its turn counter from the log when it is built, so the
 * opening has to be in the stored log by then: the chat is then adopted by id.
 */
export async function storeOpening(
  persistence: SessionPersistenceLike,
  chat: { id: string; cwd: string; agentPreset: string },
  segments: readonly NarrationSegment[],
): Promise<void> {
  const header: SessionHeader = { version: 4, id: SessionId(chat.id), createdAt: Date.now(), cwd: chat.cwd, isSeeded: false, agentPreset: chat.agentPreset }
  const handle = await persistence.create(header)
  try {
    await handle.append(openingEvents(segments))
    await handle.flush()
  } finally {
    await handle.close()
  }
}
