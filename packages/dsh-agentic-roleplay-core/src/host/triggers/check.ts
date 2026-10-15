import { createSessionStore, triggerReferenceProblems, type Session } from '@dsh-agentic-roleplay/state'
import type { CharacterDefinition, ItemDefinition, LocationDefinition, Slot, TriggerDefinition, VariableDefinitionInput } from 'dsh-roleplay-model'
import { populateCharacters, populateItems, populateLocations, populateVariables } from '../sessions/populate.ts'

export interface WorldParts {
  characters: readonly CharacterDefinition[]
  locations: readonly LocationDefinition[]
  items: readonly ItemDefinition[]
  slots: readonly Slot[]
  variables: readonly VariableDefinitionInput[]
}

/**
 * What each trigger names that the world does not have (a character, place, item or variable in its condition, its cues or the words of a
 * cue), found as a session start finds it: against a scratch story made from the world's files. Triggers that wait for each other count
 * as there. @returns the problems by trigger key; a trigger with none is not in it.
 */
export function triggerProblemsOf(parts: WorldParts, definitions: readonly TriggerDefinition[]): Map<string, string[]> {
  const found = new Map<string, string[]>()
  if (definitions.length === 0) return found
  const scratch = createSessionStore(':memory:', { id: 'scratch', name: 'scratch', world: { id: 'scratch', name: 'scratch' } }, { vectors: false })
  try {
    // The populate functions use only the repositories, which a store has; the search a session adds is not needed.
    const session = scratch as unknown as Session
    populateLocations(session, parts.locations)
    populateCharacters(session, parts.characters, parts.characters.find(character => character.role === 'playable')?.id ?? '')
    populateItems(session, parts.items, parts.slots, parts.locations)
    populateVariables(session, parts.variables, { characters: parts.characters, items: parts.items, locations: parts.locations, values: undefined })
    const keys = definitions.map(definition => definition.key)
    for (const definition of definitions) {
      const problems = triggerReferenceProblems(scratch, definition, keys).map(problem => problem.slice(definition.key.length + 2))
      if (problems.length > 0) found.set(definition.key, problems)
    }
  } finally {
    scratch.close()
  }
  return found
}
