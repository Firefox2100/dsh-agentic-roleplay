import { InvalidEditProblems } from '../../shared/world-state.ts'
import { loadCalendar } from '../calendar/load.ts'
import { loadCharacters } from '../characters/load.ts'
import { loadItems } from '../items/load.ts'
import { loadLocations } from '../locations/load.ts'
import { loadVariables } from '../variables/load.ts'
import type { WorldParts } from './check.ts'

/** What the files of a world say it has, for checking what a trigger names. @throws {InvalidEditProblems} when those files have problems of their own: they are fixed first. */
export async function loadWorldParts(directory: string): Promise<WorldParts> {
  const { characters, problems: characterProblems } = await loadCharacters(directory)
  const { locations, problems: locationProblems } = await loadLocations(directory)
  const { items, slots, problems: itemProblems } = await loadItems(directory, { characters: characters.map(character => character.id), locations })
  const { defs, problems: variableProblems } = await loadVariables(directory)
  const { calendar, problems: calendarProblems } = await loadCalendar(directory)
  const problems = [...characterProblems, ...locationProblems, ...itemProblems, ...variableProblems, ...calendarProblems]
  if (problems.length > 0) throw new InvalidEditProblems([`the world's other files have problems that come first: ${problems.map(problem => `${problem.path}: ${problem.message}`).join('; ')}`])
  return { characters, locations, items, slots, variables: defs, calendar }
}
