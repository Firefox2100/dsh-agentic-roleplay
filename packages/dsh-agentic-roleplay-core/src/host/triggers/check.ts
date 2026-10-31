import { triggerReferenceProblems } from '@dsh-agentic-roleplay/state'
import type { TriggerDefinition } from 'dsh-roleplay-model'
import { withScratchStory, type WorldParts } from '../worlds/scratch.ts'

export type { WorldParts }

/**
 * What each trigger names that the world does not have (a character, place, item or variable in its condition, its cues or the words of a
 * cue), found as a session start finds it: against a scratch story made from the world's files. Triggers that wait for each other count
 * as there. @returns the problems by trigger key; a trigger with none is not in it.
 */
export function triggerProblemsOf(parts: WorldParts, definitions: readonly TriggerDefinition[]): Map<string, string[]> {
  const found = new Map<string, string[]>()
  if (definitions.length === 0) return found
  withScratchStory(parts, story => {
    const keys = definitions.map(definition => definition.key)
    for (const definition of definitions) {
      const problems = triggerReferenceProblems(story, definition, keys).map(problem => problem.slice(definition.key.length + 2))
      if (problems.length > 0) found.set(definition.key, problems)
    }
  })
  return found
}
