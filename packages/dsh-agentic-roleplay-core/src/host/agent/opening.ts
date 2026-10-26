import { createMessage, createSystemMessage, createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session'
import { setApprovalPolicy } from '@deepseek-ai/dsh-user-approval'
import { encodeOutput, type NarrationSegment, type TurnOutput } from '../../shared/narration.ts'

/** What the opening is reported to come from, where a chat shows the source of a message. */
export const OPENING_SOURCE = { provider: 'roleplay', model: 'opening' } as const
export const AUTHORING_OPENING_SOURCE = { provider: 'world-authoring', model: 'opening' } as const
export const DOCTOR_OPENING_SOURCE = { provider: 'session-doctor', model: 'opening' } as const

const NARRATE_TOOL = 'narrate'

/** The slice of DSH's session persistence used to store a chat before its agent exists. */
export interface SessionPersistenceLike {
  stat?(id: SessionId): Promise<unknown | undefined>
  create(header: SessionHeader): Promise<{
    append(events: readonly SessionEvent[]): Promise<unknown>
    flush(): Promise<unknown>
    close(): Promise<void>
  }>
}

/**
 * The first node of a conversation's surface is the system prompt, even an empty one: the log format refuses a system prompt that
 * arrives after other nodes, which is what a chat that starts with an opening would otherwise get at its first real turn. The agent
 * replaces this empty head with the real prompt then.
 */
function reservePromptHead(session: Session, turn: number, step: number): void {
  session.append('system/message', { turn, step, message: createSystemMessage('') }, { surfaceOp: 'append' })
}

/** What a narrated turn leaves in the log: the events of one finished turn, and where they stand. */
export interface TurnSeqs { startSeq: number; userSeq?: number; endSeq: number }

/**
 * One finished turn in which the output was delivered the way every turn delivers it (a `narrate` call and its result), so it renders
 * the same and the model reads a history that looks like the one it will write. A turn with a player starts with the player's message.
 */
export function appendNarratedTurn(session: Session, turn: number, output: TurnOutput, player?: string): TurnSeqs {
  const step = 1
  const callId = ToolCallId(player === undefined ? 'opening-narrate' : `narrate-${turn}`)
  const sent = output.segments.map(segment => (segment.type === 'utterance'
    ? { type: 'utterance', character: segment.character, text: segment.text }
    : { type: 'narration', text: segment.text }))
  const args = JSON.stringify({ segments: sent })

  const started = session.append('turn/start', { turn })
  session.append('step/start', { turn, step })
  let asked: number | undefined
  if (player === undefined) reservePromptHead(session, turn, step)
  else asked = session.append('user/message', createMessage({ role: 'user', content: [{ type: 'text', text: player }], source: { kind: 'user' } }), { surfaceOp: 'append' }).seq
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
      content: [{ type: 'text', text: `The output has been delivered to the player. The turn ends here.\n${encodeOutput(output)}` }],
      isError: false,
    }),
  }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
  session.append('step/end', { turn, step })
  const ended = session.append('turn/end', { turn, reason: { kind: 'completed' } })
  return { startSeq: started.seq, ...(asked === undefined ? {} : { userSeq: asked }), endSeq: ended.seq }
}

/** A turn in which nothing was said and nothing was delivered, to keep the log's turns consecutive. */
export function appendEmptyTurn(session: Session, turn: number): void {
  session.append('turn/start', { turn })
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
}

/**
 * The log of a chat that opens with a story: a finished first turn. The player's message starts the second turn. Nothing is asked of a model.
 */
export function openingEvents(segments: readonly NarrationSegment[]): readonly SessionEvent[] {
  const session = Session.create(SessionId('opening'))
  appendNarratedTurn(session, 1, { segments: [...segments], repaired: false })
  return session.snapshotEvents()
}

/** A visible first turn makes a newly created authoring chat a full conversation immediately. */
export function authoringOpeningEvents(welcome: string, source: { provider: string; model: string } = AUTHORING_OPENING_SOURCE): readonly SessionEvent[] {
  const session = Session.create(SessionId('authoring-opening'))
  setApprovalPolicy(session, 'ask')
  const turn = 1
  const step = 1
  session.append('turn/start', { turn })
  session.append('step/start', { turn, step })
  reservePromptHead(session, turn, step)
  session.append('assistant/message', {
    stream: [],
    turn,
    step,
    message: createMessage({
      role: 'assistant',
      content: [{ type: 'text', text: welcome }],
      source: { kind: 'model', ...source },
    }),
  }, { surfaceOp: 'append' })
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
  events: readonly SessionEvent[] = openingEvents(segments),
): Promise<void> {
  await storeInitialEvents(persistence, chat, events)
}

export async function storeAuthoringOpening(
  persistence: SessionPersistenceLike,
  chat: { id: string; cwd: string; agentPreset: string },
  welcome: string,
): Promise<void> {
  await storeInitialEvents(persistence, chat, authoringOpeningEvents(welcome))
}

export async function storeDoctorOpening(
  persistence: SessionPersistenceLike,
  chat: { id: string; cwd: string; agentPreset: string },
  welcome: string,
): Promise<void> {
  await storeInitialEvents(persistence, chat, authoringOpeningEvents(welcome, DOCTOR_OPENING_SOURCE))
}

export async function storeInitialEvents(
  persistence: SessionPersistenceLike,
  chat: { id: string; cwd: string; agentPreset: string },
  events: readonly SessionEvent[],
): Promise<void> {
  const header: SessionHeader = { version: 4, id: SessionId(chat.id), createdAt: Date.now(), cwd: chat.cwd, isSeeded: false, agentPreset: chat.agentPreset }
  const handle = await persistence.create(header)
  try {
    await handle.append(events)
    await handle.flush()
  } finally {
    await handle.close()
  }
}
