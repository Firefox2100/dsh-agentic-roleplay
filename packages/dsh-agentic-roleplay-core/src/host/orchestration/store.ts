import { sessionFolder, type RoleplayState, type Session } from 'dsh-roleplay-state'
import { roleplaySessionOf } from '../../shared/chat.ts'
import { liveSettings } from '../sessions/settings.ts'
import type { CastMember, RoundRecord, TurnStore } from './boundaries.ts'

export { roleplaySessionOf }

function storeOf(session: Session, folder: string, problem: (message: string) => void, queryVector: TurnStore['queryVector']): TurnStore {
  return {
    story: session,
    cast: (): CastMember[] => session.characters.list().map(character => {
      const state = session.characterStates.get(character.id)
      return { key: character.sourceId ?? String(character.id), character, ...(state === undefined ? {} : { state }) }
    }),
    settings: () => liveSettings(folder, problem),
    commit: (updates) => {
      session.transaction(() => {
        for (const { character, patch } of updates) session.characterStates.update(character, patch)
      })
    },
    completeTurn: () => { session.metadata.recordTurn() },
    queueCommit: record => { session.pendingCommits.enqueue(record.turn, record.round, JSON.parse(JSON.stringify(record)) as never) },
    pendingCommits: () => session.pendingCommits.list().map(entry => entry.payload as unknown as RoundRecord),
    completeCommits: (rounds) => {
      session.transaction(() => {
        session.events.seal()
        session.pendingCommits.complete(rounds)
      })
    },
    queryVector,
  }
}

/** Opens the store of the roleplay session behind a chat; a chat that is not one gets none. */
export function storesOf(
  state: Pick<RoleplayState, 'openSession'>,
  sessionsDir: () => string,
  problem: (message: string) => void = () => undefined,
  /** The vector of a text for a chat's search, from the embedding index; none without one. */
  queryVector: (chat: string, text: string, signal?: AbortSignal) => Promise<readonly number[] | undefined> = () => Promise.resolve(undefined),
): (chat: string) => TurnStore | undefined {
  return (chat) => {
    const id = roleplaySessionOf(chat)
    if (id === undefined) return undefined
    try {
      return storeOf(state.openSession(sessionsDir(), id), sessionFolder(sessionsDir(), id), problem, (text, signal) => queryVector(chat, text, signal))
    } catch {
      return undefined
    }
  }
}
