import type { CharacterDefinition } from 'dsh-roleplay-model'
import type { Session } from 'dsh-roleplay-state'

/**
 * Put a world's cast into a new session: each character with the state it
 * starts in and its intents. The player controls the character whose world id
 * is `playerId`; the agent controls everyone else.
 */
export function populateCharacters(session: Session, characters: readonly CharacterDefinition[], playerId: string): void {
  for (const { id, start, ...identity } of characters) {
    const character = session.characters.add({ ...identity, sourceId: id, control: id === playerId ? 'player' : 'agent' })
    const { intents, ...state } = start
    session.characterStates.create(character.id, state)
    for (const intent of intents) session.intents.add(character.id, intent)
  }
}
