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

/** Something said to a character who was asleep, which it answers once it wakes. */
export interface AutonomyWaiting {
  character: string
  name: string
  /** What happened where the character could not answer, as the game master described it to them, oldest first. */
  situations: string[]
  /** When it was said, in UTC milliseconds. */
  at: number
}

/** The most replies kept waiting for sleepers. */
const MAX_WAITING = 10

/** What the story did on its own since the player last wrote. */
export interface AutonomyState {
  /** How many things the characters did on their own with no message from the player in between. */
  unanswered: number
  /** When each character was last asked whether to write, by key (whether it wrote or not). */
  sent: Record<string, number>
  /** What the story has not been told of yet. */
  inbox: AutonomyMessage[]
  /** What was said to characters who were asleep, to be answered when they wake: one per character. */
  waiting: AutonomyWaiting[]
}

const isMessage = (value: unknown): value is AutonomyMessage => {
  const entry = value as Record<string, unknown> | null
  return typeof entry === 'object' && entry !== null && typeof entry['at'] === 'number' && typeof entry['character'] === 'string' && typeof entry['name'] === 'string' && typeof entry['text'] === 'string'
}

const isWaiting = (value: unknown): value is AutonomyWaiting => {
  const entry = value as Record<string, unknown> | null
  return typeof entry === 'object' && entry !== null && typeof entry['at'] === 'number' && typeof entry['character'] === 'string' && typeof entry['name'] === 'string' && (typeof entry['situation'] === 'string' || (Array.isArray(entry['situations']) && entry['situations'].every(line => typeof line === 'string')))
}

/** A reply kept by an older version held one situation; it is the same as a list of one. */
const withSituations = (entry: AutonomyWaiting & { situation?: string }): AutonomyWaiting => {
  const { situation, ...rest } = entry
  return { ...rest, situations: Array.isArray(entry.situations) ? entry.situations : situation === undefined ? [] : [situation] }
}

export function readAutonomy(session: AutonomySession): AutonomyState {
  const stored = session.metadata.getValue(KEY) as Partial<AutonomyState> | undefined
  const sent = typeof stored?.sent === 'object' && stored.sent !== null && !Array.isArray(stored.sent) ? Object.fromEntries(Object.entries(stored.sent).filter(([, value]) => typeof value === 'number')) : {}
  return { unanswered: typeof stored?.unanswered === 'number' ? stored.unanswered : 0, sent, inbox: Array.isArray(stored?.inbox) ? stored.inbox.filter(isMessage) : [], waiting: Array.isArray(stored?.waiting) ? stored.waiting.filter(isWaiting).map(entry => withSituations(entry as never)) : [] }
}

/** A character wrote to the player: it counts as one more thing done without a reply, and waits to be told to the story. */
export function recordMessage(session: AutonomySession, message: AutonomyMessage): AutonomyState {
  const state = readAutonomy(session)
  const next: AutonomyState = { ...state, unanswered: state.unanswered + 1, sent: { ...state.sent, [message.character]: message.at }, inbox: [...state.inbox, message].slice(-MAX_INBOX) }
  session.metadata.setValue(KEY, next as never)
  return next
}

/** A character was asked whether it wants to write and did not: it is not asked again until the gap has passed. */
export function recordAsk(session: AutonomySession, character: string, at: number): void {
  const state = readAutonomy(session)
  session.metadata.setValue(KEY, { ...state, sent: { ...state.sent, [character]: at } } as never)
}

/** The most things kept for one sleeper: it answers them together when it wakes. */
const MAX_SITUATIONS = 5

/** Something was left for a sleeper: it is kept with what was already waiting for the same character, to be answered when the character wakes. */
export function queueReply(session: AutonomySession, waiting: AutonomyWaiting): void {
  const state = readAutonomy(session)
  const before = state.waiting.find(entry => entry.character === waiting.character)
  const situations = [...(before?.situations ?? []), ...waiting.situations.filter(line => !(before?.situations ?? []).includes(line))].slice(-MAX_SITUATIONS)
  session.metadata.setValue(KEY, { ...state, waiting: [...state.waiting.filter(entry => entry.character !== waiting.character), { ...waiting, situations }].slice(-MAX_WAITING) } as never)
}

/** These replies are no longer waiting: they were answered, or the character did not want to. */
export function dropWaiting(session: AutonomySession, characters: readonly string[]): void {
  const state = readAutonomy(session)
  if (!state.waiting.some(entry => characters.includes(entry.character))) return
  session.metadata.setValue(KEY, { ...state, waiting: state.waiting.filter(entry => !characters.includes(entry.character)) } as never)
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
