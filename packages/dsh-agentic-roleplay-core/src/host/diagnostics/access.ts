import type { CharacterAccess, WithheldNames } from '../../shared/trace.ts'
import type { CharacterRequest, TurnStore } from '../orchestration/boundaries.ts'

const MAX_NAMES = 12

const unknown = <T>(all: readonly T[], known: ReadonlySet<string>, name: (entry: T) => string): string[] => all.map(name).filter(entry => !known.has(entry))

/**
 * What a character was given for an activation, counted by kind, and what the story holds that it was not given: the people, places, things, ways, groups and background it has
 * no knowledge of, hidden things where it stands, and the events it took no part in. A missing edge means not knowing, so each count is what the world has less what the character knows.
 * The names behind the counts are what the character must not know, and are kept only when asked for.
 */
export function accessOf(story: TurnStore['story'], request: CharacterRequest, withNames: boolean): CharacterAccess {
  const { member, knowledge, memories = [], relationships = [], carrying = [], cues = [], affiliations = [] } = request
  const known = knowledge ?? { characters: [], factions: [], locations: [], items: [], routes: [], lore: [] }
  const here = new Set([member.key, member.character.name, ...(request.place?.here ?? request.cast).map(entry => entry.character.name)])
  const people = unknown(story.characters.list(), new Set([...known.characters, ...here]), character => character.name)
  const places = unknown(story.locations.list(), new Set(known.locations), place => place.name)
  const seenThings = new Set([...known.items, ...carrying.map(item => item.name), ...(request.place?.items ?? []).map(item => item.name)])
  const things = unknown(story.items.list().filter(item => !item.hidden), seenThings, item => item.name)
  const factions = unknown(story.factions.list(), new Set([...known.factions, ...affiliations.map(entry => entry.name)]), faction => faction.name)
  const lore = unknown(story.lore.list(), new Set(known.lore), entry => entry.title)
  const allExits = story.locations.allExits().length
  const placeId = member.place?.location.id
  const hidden = placeId === undefined ? [] : story.items.contents({ kind: 'location', id: placeId }).filter(entry => entry.item.hidden).map(entry => entry.item.name)
  const events = Math.max(0, story.events.list().length - story.events.perceivedBy(member.character.id).length)
  const names: WithheldNames = { people, places, things, factions, lore }
  return {
    character: member.character.name,
    attempt: request.attempt,
    given: {
      people: known.characters.length, places: known.locations.length, things: known.items.length, routes: known.routes.length, factions: known.factions.length, lore: known.lore.length,
      memories: { clear: memories.filter(memory => memory.clarity === 'clear').length, faded: memories.filter(memory => memory.clarity === 'faded').length, vague: memories.filter(memory => memory.clarity === 'vague').length },
      relationships: relationships.length, present: Math.max(0, (request.place?.here ?? request.cast).length - 1), carrying: carrying.length, cues: cues.length,
    },
    withheld: { people: people.length, places: places.length, things: things.length, routes: Math.max(0, allExits - known.routes.length), factions: factions.length, lore: lore.length, hidden: hidden.length, events },
    ...withNames ? { names: Object.fromEntries(Object.entries({ ...names, things: [...things, ...hidden.map(name => `${name} (hidden)`)] }).filter(([, list]) => list.length > 0).map(([kind, list]) => [kind, list.slice(0, MAX_NAMES)])) } : {},
  }
}
