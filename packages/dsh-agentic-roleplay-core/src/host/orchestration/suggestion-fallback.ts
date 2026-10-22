import { languageOf, translator } from 'dsh-roleplay-model'
import type { TurnStore } from './boundaries.ts'
import { MAX_SUGGESTION, suggestionProblems, tidySuggestions } from './suggestions.ts'

/**
 * Lines made from the story's own data when the suggester could not make any, so the player is never left with an empty tray:
 * someone to talk to, a way out, a thing to look at, then plain standbys. No model is asked.
 */
export function fallbackSuggestions(store: TurnStore, count: number): string[] {
  const tr = translator(languageOf(store.settings().prompts.language))
  const player = store.cast().find(member => member.character.control === 'player')
  const view = player?.place === undefined ? undefined : store.place(player.place.location.id)
  const people = (view?.here ?? []).filter(member => member.character.id !== player?.character.id).map(member => tr('Talk to {name}.', { name: member.character.name }))
  const ways = (view?.exits ?? []).filter(({ exit }) => exit.state === 'open').map(({ name }) => tr('Go to {place}.', { place: name }))
  const things = (view?.items ?? []).filter(item => !item.hidden).map(item => tr('Take a closer look at {thing}.', { thing: item.name }))
  const standbys = [tr('Look around carefully.'), tr('Wait and see what happens.'), tr('Ask what is going on.'), tr('Think about what to do next.')]
  const lanes = [people, ways, things]
  const picked: string[] = []
  for (let round = 0; picked.length < count && lanes.some(lane => lane.length > round); round++) {
    for (const lane of lanes) if (picked.length < count && lane[round] !== undefined) picked.push(lane[round]!)
  }
  for (const line of standbys) if (picked.length < count) picked.push(line)
  const lines = tidySuggestions(picked).map(line => (line.length > MAX_SUGGESTION ? `${line.slice(0, MAX_SUGGESTION - 1)}…` : line))
  return suggestionProblems(lines, count).length === 0 ? lines : []
}
