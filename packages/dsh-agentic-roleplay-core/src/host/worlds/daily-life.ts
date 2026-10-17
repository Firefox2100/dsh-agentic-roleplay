import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { RoutineDefinition } from 'dsh-roleplay-model'
import type { CalendarDocument, VariableDeclaration, WorldRoutines } from '../../shared/world-daily.ts'
import { InvalidEditProblems } from '../../shared/world-state.ts'
import { CHARACTERS_DIR, loadCharacters } from '../characters/load.ts'
import { CHARACTER_FILE_NAME, parseCharacterFile } from '../characters/character-file.ts'
import { CALENDAR_FILE_NAME, loadCalendar, parseCalendarFile } from '../calendar/load.ts'
import { TRIGGERS_FILE_NAME } from '../triggers/load.ts'
import { loadItems } from '../items/load.ts'
import { loadLocations } from '../locations/load.ts'
import { routineProblems } from '../sessions/populate.ts'
import { parseVariablesFile, variableProblems, VARIABLES_FILE_NAME } from '../variables/load.ts'
import { formatIssue } from '../validation.ts'
import { parseWorldFile, WORLD_FILE_NAME } from './world-file.ts'
import { entityFolder, replaceFile, type EditableWorld } from './world-editor.ts'

type Json = Record<string, unknown>

/** The day each character lives, and the places its windows may name. */
export async function readRoutines(world: EditableWorld): Promise<WorldRoutines> {
  const [{ characters }, { locations }] = await Promise.all([loadCharacters(world.directory), loadLocations(world.directory)])
  return {
    characters: characters.map(character => ({ key: character.id, name: character.name, routine: character.routine ?? [] })),
    places: locations.map(place => ({ key: place.id, name: place.name, features: place.features.map(feature => ({ key: feature.key, name: feature.name })) })),
  }
}

/**
 * Replaces the day of one character in its file, keeping everything else in it. The times, days and places are checked as the world is read at a start.
 * @throws {InvalidEditProblems} when the character does not exist or a window is not acceptable; nothing is written.
 */
export async function editRoutine(world: EditableWorld, key: string, windows: readonly RoutineDefinition[]): Promise<WorldRoutines> {
  const folder = await entityFolder(world.directory, CHARACTERS_DIR, CHARACTER_FILE_NAME, key, parseCharacterFile as never)
  if (folder === undefined) throw new InvalidEditProblems([`there is no character "${key}"`])
  const file = join(world.directory, CHARACTERS_DIR, folder, CHARACTER_FILE_NAME)
  const text = (await readFile(file, 'utf8')).replace(/^﻿/, '')
  const document = JSON.parse(text) as Json
  if (windows.length === 0) delete document['routine']
  else document['routine'] = windows
  const next = JSON.stringify(document, null, /^([ \t]+)"/m.exec(text)?.[1] ?? '  ') + (text.endsWith('\n') ? '\n' : '')
  const parsed = parseCharacterFile(next, folder)
  if (!parsed.ok) throw new InvalidEditProblems(parsed.issues.map(formatIssue))
  const { locations } = await loadLocations(world.directory)
  const { calendar } = await loadCalendar(world.directory)
  const places = routineProblems([parsed.value], locations, calendar)
  if (places.length > 0) throw new InvalidEditProblems(places)
  await replaceFile(file, next)
  return await readRoutines(world)
}

/** The variables the world declares, as the file writes them. */
export async function readVariables(world: EditableWorld): Promise<VariableDeclaration[]> {
  try {
    const parsed = JSON.parse((await readFile(join(world.directory, VARIABLES_FILE_NAME), 'utf8')).replace(/^﻿/, '')) as unknown
    return Array.isArray(parsed) ? parsed as VariableDeclaration[] : []
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

/**
 * Replaces the world's declarations. They are read as the world is at a start and checked against everything that has a value for one: a variable a
 * character, item, place or the world still gives a value to cannot be removed, and a value must still fit its declaration.
 * @throws {InvalidEditProblems} naming each problem; nothing is written.
 */
export async function editVariables(world: EditableWorld, declarations: readonly VariableDeclaration[]): Promise<VariableDeclaration[]> {
  const text = `${JSON.stringify(declarations, null, 2)}\n`
  const parsed = parseVariablesFile(text)
  if (!parsed.ok) throw new InvalidEditProblems(parsed.issues.map(formatIssue))
  const [{ characters }, { locations }] = await Promise.all([loadCharacters(world.directory), loadLocations(world.directory)])
  const { items } = await loadItems(world.directory, { characters: characters.map(character => character.id), locations })
  const worldFile = parseWorldFile(await readFile(join(world.directory, WORLD_FILE_NAME), 'utf8'))
  const problems = variableProblems({ defs: parsed.value, characters, items, locations, values: worldFile.ok ? worldFile.value.variables : undefined })
  if (problems.length > 0) throw new InvalidEditProblems(problems)
  if (declarations.length === 0) await rm(join(world.directory, VARIABLES_FILE_NAME), { force: true })
  else await replaceFileOrCreate(join(world.directory, VARIABLES_FILE_NAME), text)
  return await readVariables(world)
}

async function replaceFileOrCreate(file: string, text: string): Promise<void> {
  try { await replaceFile(file, text) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    await writeFile(file, text, { flag: 'wx' })
  }
}


/** The calendar of the world as `calendar.json` writes it; a world without one has the northern seasons and no holidays. */
export async function readCalendarDocument(world: EditableWorld): Promise<CalendarDocument> {
  const { calendar } = await loadCalendar(world.directory)
  return { hemisphere: calendar.hemisphere, holidays: calendar.holidays.map(holiday => ({ id: holiday.id, name: holiday.name, on: [...holiday.on] })) }
}

/**
 * Replaces the calendar. The days are read as the file is at a start, and a holiday that a routine of a character or a trigger still names cannot be removed or renamed.
 * A calendar with no holidays and the northern seasons is no file at all.
 * @throws {InvalidEditProblems} naming each problem; nothing is written.
 */
export async function editCalendar(world: EditableWorld, calendar: CalendarDocument): Promise<CalendarDocument> {
  const text = `${JSON.stringify(calendar, null, 2)}\n`
  const parsed = parseCalendarFile(text)
  if (!parsed.ok) throw new InvalidEditProblems(parsed.issues.map(formatIssue))
  const [{ characters }, { locations }] = await Promise.all([loadCharacters(world.directory), loadLocations(world.directory)])
  const problems = routineProblems(characters, locations, parsed.value)
  const triggers = await readFile(join(world.directory, TRIGGERS_FILE_NAME), 'utf8').catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return ''; throw error })
  const named = new Set(calendar.holidays.map(holiday => holiday.id))
  for (const id of new Set([...triggers.matchAll(/holiday:([\p{L}\p{N}_-]+)/gu)].map(match => match[1]!))) if (!named.has(id)) problems.push(`a trigger names the holiday "${id}", which the calendar does not have`)
  if (problems.length > 0) throw new InvalidEditProblems(problems)
  if (calendar.holidays.length === 0 && calendar.hemisphere === 'north') await rm(join(world.directory, CALENDAR_FILE_NAME), { force: true })
  else await replaceFileOrCreate(join(world.directory, CALENDAR_FILE_NAME), text)
  return await readCalendarDocument(world)
}
