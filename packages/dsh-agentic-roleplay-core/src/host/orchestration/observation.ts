import type { Session } from '@dsh-agentic-roleplay/state'

type Observer = Pick<Session, 'placements' | 'locations' | 'items' | 'knowledge' | 'characters'>

/** What a character takes in where it stands and of what it carries: the place, the ways out and what they lead to, what lies in the open, what it holds. */
export function observeSurroundings(session: Observer, characterId: number, turn: number): void {
  const placement = session.placements.get('character', characterId)
  if (placement !== undefined) {
    session.knowledge.learn(characterId, 'location', placement.locationId, turn, true)
    for (const exit of session.locations.exitsFrom(placement.locationId)) {
      session.knowledge.learn(characterId, 'exit', exit.id, turn, true)
      session.knowledge.learn(characterId, 'location', exit.toId, turn)
    }
    for (const { item } of session.items.contents({ kind: 'location', id: placement.locationId })) if (!item.hidden) session.knowledge.learn(characterId, 'item', item.id, turn, true)
  }
  for (const { item } of session.items.contents({ kind: 'character', id: characterId })) session.knowledge.learn(characterId, 'item', item.id, turn, true)
}

/**
 * The player's character is never asked to act, so nothing else shows it its surroundings: it takes them in when a turn begins, which is
 * how it comes to know the way back from where it went.
 */
export function observeAsPlayer(session: Observer, turn: number): void {
  const player = session.characters.list().find(character => character.control === 'player')
  if (player !== undefined) observeSurroundings(session, player.id, turn)
}
