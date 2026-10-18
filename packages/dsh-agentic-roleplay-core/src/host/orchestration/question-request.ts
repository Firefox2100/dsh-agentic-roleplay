import type { Boundaries, CharacterRequest, TurnStore } from './boundaries.ts'
import { knownRelationships } from './turn-rules.ts'
import type { TurnOwner } from './turn-engine.ts'

/** What the player's character is given to answer a question with: the same as a character is given to act, with the question as the moment. */
export async function questionRequest(boundaries: Boundaries, store: TurnStore, owner: TurnOwner, question: string, signal: AbortSignal): Promise<CharacterRequest> {
  const cast = store.cast()
  const member = cast.find(candidate => candidate.character.control === 'player')
  if (member === undefined) throw new Error('there is no player\'s character to answer for')
  const queryVector = await store.queryVector(question, signal)
  const memories = await boundaries.recaller.recall({ member, situation: question, turn: owner.turn, policy: store.settings().memory, ...(queryVector === undefined ? {} : { queryVector }) }, store.story, signal)
  const place = member.place === undefined ? undefined : store.place(member.place.location.id)
  const company = place === undefined ? cast : place.here
  const relationships = knownRelationships(member, company, question, cast, store)
  const carrying = store.carried(member.character.id)
  const affiliations = store.affiliations(member.character.id)
  const tracked = store.trackedFor(member.character.id, company.map(entry => entry.character.id))
  return {
    member, cast, situation: question, attempt: 1, language: store.settings().prompts.language, turn: owner.turn, lookup: false, text: (id, variables) => store.text(id, variables),
    time: store.time(owner.turn),
    knowledge: store.knowledge(member.character.id, owner.turn, company.map(entry => entry.character.id)),
    ...(tracked.self === '' && tracked.others.length === 0 ? {} : { tracked }),
    ...(place === undefined ? {} : { place }),
    ...(relationships.length === 0 ? {} : { relationships }),
    ...(carrying.length === 0 ? {} : { carrying }),
    ...(affiliations.length === 0 ? {} : { affiliations }),
    ...(memories.length === 0 ? {} : { memories }),
  }
}
