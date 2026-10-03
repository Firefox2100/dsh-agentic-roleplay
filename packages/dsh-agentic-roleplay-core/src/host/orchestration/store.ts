import { sessionFolder, type RoleplayState, type Session } from 'dsh-roleplay-state'
import { roleplaySessionOf } from '../../shared/chat.ts'
import { readSettings } from '../sessions/settings.ts'
import type { CastMember, TurnStore } from './boundaries.ts'

export { roleplaySessionOf }

function storeOf(session: Session, folder: string): TurnStore {
  return {
    cast: (): CastMember[] => session.characters.list().map(character => {
      const state = session.characterStates.get(character.id)
      return { key: character.sourceId ?? String(character.id), character, ...(state === undefined ? {} : { state }) }
    }),
    settings: () => readSettings(folder),
    commit: (updates) => {
      session.transaction(() => {
        for (const { character, patch } of updates) session.characterStates.update(character, patch)
      })
    },
    completeTurn: () => { session.metadata.recordTurn() },
  }
}

/** Opens the store of the roleplay session behind a chat; a chat that is not one gets none. */
export function storesOf(state: Pick<RoleplayState, 'openSession'>, sessionsDir: () => string): (chat: string) => TurnStore | undefined {
  return (chat) => {
    const id = roleplaySessionOf(chat)
    if (id === undefined) return undefined
    try {
      return storeOf(state.openSession(sessionsDir(), id), sessionFolder(sessionsDir(), id))
    } catch {
      return undefined
    }
  }
}
