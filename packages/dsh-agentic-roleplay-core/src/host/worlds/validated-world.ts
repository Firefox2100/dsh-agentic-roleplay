import type { WorldRecord } from './scan.ts'

/** What validating a world needs of it: where it is, what to call it in a message, and what the world file starts its tracked values with. */
export interface CheckedWorld {
  directory: string
  summary: { name: string }
  variables?: WorldRecord['variables']
}
import { loadCharacters } from '../characters/load.ts'
import { loadCalendar } from '../calendar/load.ts'
import { commandFlag, commandVariable, loadCommands } from '../commands/load.ts'
import { loadDice } from '../dice/load.ts'
import { loadFactions } from '../factions/load.ts'
import { loadItems } from '../items/load.ts'
import { loadLocations } from '../locations/load.ts'
import { loadLore } from '../lore/load.ts'
import { loadTriggers } from '../triggers/load.ts'
import { loadPlots, plotReferenceProblems } from '../plots/load.ts'
import { loadVariables, variableProblems } from '../variables/load.ts'
import { InvalidWorldError } from '../sessions/errors.ts'
import { factionProblems, knowledgeProblems, loreProblems, relationshipProblems, routineProblems, startingPlaceProblems } from '../sessions/populate.ts'

/**
 * Reads everything a world's files hold and checks it all as a session start does: every file reads, and what refers to something refers to something that is there.
 * @throws {InvalidWorldError} naming every problem of the first part of the world that has any.
 */
export async function loadValidatedWorld(world: CheckedWorld) {
  const { characters, problems } = await loadCharacters(world.directory)
  if (problems.length > 0) throw new InvalidWorldError(`the characters of "${world.summary.name}" have ${problems.length} problem(s)`, problems)

  const { factions, problems: factionFileProblems } = await loadFactions(world.directory)
  if (factionFileProblems.length > 0) throw new InvalidWorldError(`the factions of "${world.summary.name}" have ${factionFileProblems.length} problem(s)`, factionFileProblems)
  const factionReferences = factionProblems(factions, characters)
  if (factionReferences.length > 0) throw new InvalidWorldError(`the factions of "${world.summary.name}" have ${factionReferences.length} problem(s)`, factionReferences.map(message => ({ path: world.directory, message })))

  const { locations, problems: locationProblems } = await loadLocations(world.directory)
  if (locationProblems.length > 0) throw new InvalidWorldError(`the places of "${world.summary.name}" have ${locationProblems.length} problem(s)`, locationProblems)
  const placing = startingPlaceProblems(characters, locations)
  if (placing.length > 0) throw new InvalidWorldError(`the starting places of "${world.summary.name}" have ${placing.length} problem(s)`, placing.map(message => ({ path: world.directory, message })))

  const { calendar, problems: calendarProblems } = await loadCalendar(world.directory)
  if (calendarProblems.length > 0) throw new InvalidWorldError(`the calendar of "${world.summary.name}" has ${calendarProblems.length} problem(s)`, calendarProblems)

  const dice = await loadDice(world.directory)
  if (dice.problems.length > 0) throw new InvalidWorldError(`the dice checks of "${world.summary.name}" have ${dice.problems.length} problem(s)`, dice.problems)

  const days = routineProblems(characters, locations, calendar)
  if (days.length > 0) throw new InvalidWorldError(`the days of the characters of "${world.summary.name}" have ${days.length} problem(s)`, days.map(message => ({ path: world.directory, message })))

  const { items, slots, problems: itemProblems } = await loadItems(world.directory, { characters: characters.map(character => character.id), locations })
  if (itemProblems.length > 0) throw new InvalidWorldError(`the items of "${world.summary.name}" have ${itemProblems.length} problem(s)`, itemProblems)
  const authoredLore = await loadLore(world.directory)
  if (authoredLore.problems.length > 0) throw new InvalidWorldError(`the lore of "${world.summary.name}" has ${authoredLore.problems.length} problem(s)`, authoredLore.problems)
  const loreReferences = loreProblems(authoredLore.lore, { characters, factions, locations, items })
  if (loreReferences.length > 0) throw new InvalidWorldError(`the lore of "${world.summary.name}" has ${loreReferences.length} invalid reference(s)`, loreReferences.map(message => ({ path: world.directory, message })))
  const knowing = knowledgeProblems(characters, locations, items, authoredLore.lore)
  if (knowing.length > 0) throw new InvalidWorldError(`the starting knowledge of "${world.summary.name}" has ${knowing.length} problem(s)`, knowing.map(message => ({ path: world.directory, message })))

  const declared = await loadVariables(world.directory)
  if (declared.problems.length > 0) throw new InvalidWorldError(`the variables of "${world.summary.name}" have ${declared.problems.length} problem(s)`, declared.problems)
  const commandFile = await loadCommands(world.directory)
  if (commandFile.problems.length > 0) throw new InvalidWorldError(`the commands of "${world.summary.name}" have ${commandFile.problems.length} problem(s)`, commandFile.problems)
  const own = new Set(declared.defs.map(def => def.key))
  const clashing = commandFile.commands.filter(command => own.has(commandVariable(command)))
  if (clashing.length > 0) throw new InvalidWorldError(`the commands of "${world.summary.name}" have ${clashing.length} problem(s)`, clashing.map(command => ({ path: world.directory, message: `/${command.word} raises the flag ${commandVariable(command)}, which variables.json declares too: remove one` })))
  declared.defs = [...declared.defs, ...commandFile.commands.map(commandFlag)]
  const tracking = variableProblems({ defs: declared.defs, characters, items, locations, values: world.variables })
  if (tracking.length > 0) throw new InvalidWorldError(`what "${world.summary.name}" tracks has ${tracking.length} problem(s)`, tracking.map(message => ({ path: world.directory, message })))

  const scripted = await loadTriggers(world.directory)
  if (scripted.problems.length > 0) throw new InvalidWorldError(`the triggers of "${world.summary.name}" have ${scripted.problems.length} problem(s)`, scripted.problems)
  const authoredPlots = await loadPlots(world.directory)
  if (authoredPlots.problems.length > 0) throw new InvalidWorldError(`the plots of "${world.summary.name}" have ${authoredPlots.problems.length} problem(s)`, authoredPlots.problems)
  const plotReferences = plotReferenceProblems(authoredPlots.plots, [...characters.map(entry => entry.id), ...factions.map(entry => entry.id), ...locations.map(entry => entry.id), ...items.map(entry => entry.id), ...authoredLore.lore.map(entry => entry.id)])
  if (plotReferences.length > 0) throw new InvalidWorldError(`the plots of "${world.summary.name}" have ${plotReferences.length} invalid participant(s)`, plotReferences.map(message => ({ path: world.directory, message })))

  const related = relationshipProblems(characters)
  if (related.length > 0) throw new InvalidWorldError(`the relationships of "${world.summary.name}" have ${related.length} problem(s)`, related.map(message => ({ path: world.directory, message })))
  return { characters, factions, locations, items, slots, authoredLore, declared, scripted, authoredPlots, calendar, checks: dice.checks, commands: commandFile.commands }
}
