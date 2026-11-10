import type { Session } from '@dsh-agentic-roleplay/state'

type AutonomySession = Pick<Session, 'metadata'>

const KEY = 'autonomy'
/** The most messages kept for the story to be told of at the player's next message. */
const MAX_INBOX = 20

/** A message a character wrote to the player while the player was away. */
export interface AutonomyMessage {
  /** When it was written, in UTC milliseconds. */
  at: number
  /** The character's key. */
  character: string
  name: string
  text: string
}

/** What the story did on its own since the player last wrote. */
export interface AutonomyState {
  /** How many things the characters did on their own with no message from the player in between. */
  unanswered: number
  /** When each character was last asked whether to write, by key (whether it wrote or not). */
  sent: Record<string, number>
  /** What the story has not been told of yet. */
  inbox: AutonomyMessage[]
}

const isMessage = (value: unknown): value is AutonomyMessage => {
  const entry = value as Record<string, unknown> | null
  return typeof entry === 'object' && entry !== null && typeof entry['at'] === 'number' && typeof entry['character'] === 'string' && typeof entry['name'] === 'string' && typeof entry['text'] === 'string'
}

export function readAutonomy(session: AutonomySession): AutonomyState {
  const stored = session.metadata.getValue(KEY) as Partial<AutonomyState> | undefined
  const sent = typeof stored?.sent === 'object' && stored.sent !== null && !Array.isArray(stored.sent) ? Object.fromEntries(Object.entries(stored.sent).filter(([, value]) => typeof value === 'number')) : {}
  return { unanswered: typeof stored?.unanswered === 'number' ? stored.unanswered : 0, sent, inbox: Array.isArray(stored?.inbox) ? stored.inbox.filter(isMessage) : [] }
}

/** A character wrote to the player: it counts as one more thing done without a reply, and waits to be told to the story. */
export function recordMessage(session: AutonomySession, message: AutonomyMessage): AutonomyState {
  const state = readAutonomy(session)
  const next: AutonomyState = { unanswered: state.unanswered + 1, sent: { ...state.sent, [message.character]: message.at }, inbox: [...state.inbox, message].slice(-MAX_INBOX) }
  session.metadata.setValue(KEY, next as never)
  return next
}

/** A character was asked whether it wants to write and did not: it is not asked again until the gap has passed. */
export function recordAsk(session: AutonomySession, character: string, at: number): void {
  const state = readAutonomy(session)
  session.metadata.setValue(KEY, { ...state, sent: { ...state.sent, [character]: at } } as never)
}

/** The player wrote: what the story was not told of yet, and the count of things done without a reply starts again. */
export function takeInbox(session: AutonomySession): AutonomyMessage[] {
  const state = readAutonomy(session)
  if (state.inbox.length === 0 && state.unanswered === 0) return []
  session.metadata.setValue(KEY, { ...state, unanswered: 0, inbox: [] } as never)
  return state.inbox
}

/** When the player last played: the last turn, or the start of a story not yet played. */
export function lastPlayerAt(session: Pick<Session, 'metadata'>): number | undefined {
  const { lastPlayedAt, createdAt } = session.metadata.get()
  const at = Date.parse(lastPlayedAt ?? createdAt)
  return Number.isNaN(at) ? undefined : at
}
