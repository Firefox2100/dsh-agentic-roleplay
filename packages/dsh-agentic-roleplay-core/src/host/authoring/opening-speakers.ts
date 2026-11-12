import { InvalidEditProblems } from '../../shared/world-state.ts'
import type { WorldInfoEdit } from '../../shared/world-info.ts'
import { loadCharacters } from '../characters/load.ts'

/**
 * Refuses an opening whose lines are spoken by someone the world does not have, and lists the ids it does have: a model asked to change who speaks writes a name's initials or an
 * invented id unless it is told the real ones (found live: "hale" and "oldge" for a character whose id was "miller").
 * @throws {InvalidEditProblems}
 */
export async function checkOpeningSpeakers(directory: string, edit: WorldInfoEdit): Promise<void> {
  const speakers = [...(edit.openingParts ?? []).map(part => ({ where: 'openingParts', part })), ...(edit.alternateOpenings ?? []).flatMap((entry, index) => (entry.parts ?? []).map(part => ({ where: `alternateOpenings[${index}].parts`, part })))]
  const spoken = speakers.filter(entry => entry.part.type === 'utterance')
  if (spoken.length === 0) return
  const { characters } = await loadCharacters(directory)
  const ids = new Set(characters.map(character => character.id))
  const problems = spoken.flatMap(({ where, part }) => (part.type === 'utterance' && !ids.has(part.character) ? [`${where}: "${part.character}" is not a character of this world; the characters are ${characters.map(character => `${character.id} (${character.name})`).join(', ')}`] : []))
  if (problems.length > 0) throw new InvalidEditProblems(problems)
}
