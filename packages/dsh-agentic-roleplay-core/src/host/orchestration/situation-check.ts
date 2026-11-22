import { mentioned } from '@dsh-agentic-roleplay/state'
import type { CastMember, TurnStore } from './boundaries.ts'

export interface Unknown { recipient: string; names: string[] }

/** How many times a situation is sent back for naming the same person to the same recipient; after that the game master's choice stands. */
export const NAME_REFUSALS = 2

/** Who a recipient has no way of knowing, among the characters other than the player's that a situation names (the player's character is what the moment is about): the situation is all it is told, so a name it has no edge to would be told as a fact. */
export function unknownNames(situation: string, recipients: readonly CastMember[], cast: readonly CastMember[], store: TurnStore, refused: ReadonlyMap<string, number>): Unknown[] {
  const named = mentioned(situation, cast.map(member => member.character))
  if (named.size === 0) return []
  return recipients.flatMap((member): Unknown[] => {
    const knows = new Set<number>([member.character.id, ...store.story.relationships.from(member.character.id).map(relation => relation.toId)])
    if (member.place === undefined) return []
    for (const here of store.place(member.place.location.id)?.here ?? []) knows.add(here.character.id)
    const names = cast.filter(other => other.character.control !== 'player' && named.has(other.character.id) && !knows.has(other.character.id) && (refused.get(`${member.key}|${other.key}`) ?? 0) < NAME_REFUSALS).map(other => other.key)
    return names.length === 0 ? [] : [{ recipient: member.key, names }]
  })
}

export function unknownProblem(unknown: readonly Unknown[], cast: readonly CastMember[]): string {
  const name = (key: string): string => cast.find(member => member.key === key)?.character.name ?? key
  const lines = unknown.map(entry => `${name(entry.recipient)} has no way of knowing ${entry.names.map(name).join(', ')}`)
  return `${lines.join('; ')}. The characters are told the situation as fact and know nothing else: leave out any name a character has no way of knowing, and describe such a person only as seen or heard. A name the player's character said aloud may stay, as spoken. Write the situation again.`
}
