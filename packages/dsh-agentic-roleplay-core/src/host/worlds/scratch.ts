import { createSessionStore, writeCalendar, type Calendar, type Session } from '@dsh-agentic-roleplay/state'
import type { CharacterDefinition, ItemDefinition, LocationDefinition, Slot, VariableDefinitionInput } from 'dsh-roleplay-model'
import { populateCharacters, populateItems, populateLocations, populateVariables } from '../sessions/populate.ts'

export interface WorldParts {
  characters: readonly CharacterDefinition[]
  locations: readonly LocationDefinition[]
  items: readonly ItemDefinition[]
  slots: readonly Slot[]
  variables: readonly VariableDefinitionInput[]
  calendar?: Calendar
}

/**
 * Runs `use` against an in-memory story made from the world's files, the way a session start fills one, and closes it again. The populate functions only use the repositories
 * a store has; the search a session adds is not needed.
 */
export function withScratchStory<T>(parts: WorldParts, use: (story: Session) => T): T {
  const scratch = createSessionStore(':memory:', { id: 'scratch', name: 'scratch', world: { id: 'scratch', name: 'scratch' } }, { vectors: false })
  try {
    const session = scratch as unknown as Session
    if (parts.calendar !== undefined) writeCalendar(scratch.metadata, parts.calendar)
    populateLocations(session, parts.locations)
    populateCharacters(session, parts.characters, parts.characters.find(character => character.role === 'playable')?.id ?? '')
    populateItems(session, parts.items, parts.slots, parts.locations)
    populateVariables(session, parts.variables, { characters: parts.characters, items: parts.items, locations: parts.locations, values: undefined })
    return use(session)
  } finally {
    scratch.close()
  }
}
