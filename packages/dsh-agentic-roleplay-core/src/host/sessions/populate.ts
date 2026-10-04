import type { CharacterDefinition, LocationDefinition } from 'dsh-roleplay-model'
import type { Session } from 'dsh-roleplay-state'
import { parentsFirst } from '../locations/load.ts'

/** What is wrong with where the characters start, found before anything is created. */
export function startingPlaceProblems(characters: readonly CharacterDefinition[], locations: readonly LocationDefinition[]): string[] {
  const byId = new Map(locations.map(location => [location.id, location]))
  return characters.flatMap((character) => {
    const place = character.start.place
    if (place === undefined) return []
    const location = byId.get(place.location)
    if (location === undefined) return [`${character.id}: start.location "${place.location}" is not a place of this world`]
    if (place.feature !== undefined && !location.features.some(feature => feature.key === place.feature)) {
      return [`${character.id}: start.feature "${place.feature}" is not a feature of ${location.name} (it has: ${location.features.map(feature => feature.key).join(', ') || 'none'})`]
    }
    return []
  })
}

/** Put a world's places into a new session: each inside the one it belongs to, with the ways between them (both ways unless the file says one way). */
export function populateLocations(session: Session, locations: readonly LocationDefinition[]): void {
  const ordered = parentsFirst(locations)
  for (const { id, name, description, parent, features } of ordered) {
    const parentId = parent === undefined ? undefined : session.locations.getBySourceId(parent)?.id
    session.locations.add({ sourceId: id, name, description, features, ...(parentId === undefined ? {} : { parentId }) })
  }
  for (const location of ordered) {
    const from = session.locations.getBySourceId(location.id)!
    for (const exit of location.exits) {
      const to = session.locations.getBySourceId(exit.to)!
      const shared = { ...(exit.travelSeconds === undefined ? {} : { travelSeconds: exit.travelSeconds }), state: exit.state, note: exit.note }
      if (session.locations.getExit(from.id, to.id) === undefined) session.locations.addExit({ fromId: from.id, toId: to.id, description: exit.description, ...shared })
      if (!exit.oneWay && session.locations.getExit(to.id, from.id) === undefined) session.locations.addExit({ fromId: to.id, toId: from.id, description: exit.backDescription ?? exit.description, ...shared })
    }
  }
}

/**
 * Put a world's cast into a new session: each character with the state it
 * starts in and its intents. The player controls the character whose world id
 * is `playerId`; the agent controls everyone else.
 */
export function populateCharacters(session: Session, characters: readonly CharacterDefinition[], playerId: string): void {
  for (const { id, start, ...identity } of characters) {
    const character = session.characters.add({ ...identity, sourceId: id, control: id === playerId ? 'player' : 'agent' })
    const { intents, place, ...state } = start
    session.characterStates.create(character.id, state)
    for (const intent of intents) session.intents.add(character.id, intent)
    if (place !== undefined) {
      const location = session.locations.getBySourceId(place.location)!
      session.placements.place('character', character.id, { locationId: location.id, ...(place.position === undefined ? {} : { position: place.position }), ...(place.feature === undefined ? {} : { featureKey: place.feature }) })
    }
  }
}
