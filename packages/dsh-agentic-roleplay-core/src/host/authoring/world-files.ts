import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { InvalidEditProblems } from '../../shared/world-state.ts'
import { parseCalendarEdit, parseVariablesEdit } from '../../shared/world-daily.ts'
import { parseCommandsEdit } from '../../shared/world-commands.ts'
import { parseDiceEdit } from '../../shared/world-dice.ts'
import { CALENDAR_FILE_NAME } from '../calendar/load.ts'
import { COMMANDS_FILE_NAME } from '../commands/load.ts'
import { DICE_FILE_NAME } from '../dice/load.ts'
import { VARIABLES_FILE_NAME } from '../variables/load.ts'
import { editCalendar, editCommands, editDice, editVariables, type EditOptions } from '../worlds/daily-life.ts'
import type { EditableWorld } from '../worlds/world-editor.ts'

/**
 * The whole-world files that belong to no single character, place or thing. The assistant writes them through the same functions as the world editor's panels,
 * so a document is refused for the same reasons wherever it comes from (a value a character still has, a holiday a trigger still names).
 */
const FILES = {
  variables: { file: VARIABLES_FILE_NAME, empty: [], write: (world: EditableWorld, document: unknown, options: EditOptions) => editVariables(world, parseVariablesEdit({ variables: document }), options) },
  dice: { file: DICE_FILE_NAME, empty: { checks: [] }, write: (world: EditableWorld, document: unknown, options: EditOptions) => editDice(world, parseDiceEdit(document), options) },
  commands: { file: COMMANDS_FILE_NAME, empty: { commands: [] }, write: (world: EditableWorld, document: unknown, options: EditOptions) => editCommands(world, parseCommandsEdit(document), options) },
  calendar: { file: CALENDAR_FILE_NAME, empty: { hemisphere: 'north', holidays: [] }, write: (world: EditableWorld, document: unknown, options: EditOptions) => editCalendar(world, parseCalendarEdit(document), options) },
} as const

export type WorldFileKind = keyof typeof FILES
export const WORLD_FILE_KINDS = Object.keys(FILES) as WorldFileKind[]
export const isWorldFileKind = (value: unknown): value is WorldFileKind => typeof value === 'string' && value in FILES

/** The stored document of one of these files, or its empty form when the world has none. */
export async function readWorldFile(directory: string, kind: WorldFileKind): Promise<unknown> {
  try {
    return JSON.parse((await readFile(join(directory, FILES[kind].file), 'utf8')).replace(/^\uFEFF/, ''))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return FILES[kind].empty
    throw error
  }
}

/**
 * Replaces one of the files with a complete document, checked against the rest of the world; an empty one removes the file.
 * @throws {InvalidEditProblems} naming each problem; nothing is written.
 */
export async function writeWorldFile(world: EditableWorld, kind: WorldFileKind, document: unknown, options: EditOptions = {}): Promise<void> {
  if (kind === 'variables') {
    const silent = (Array.isArray(document) ? document : []).flatMap((entry: Record<string, unknown>) => (entry !== null && typeof entry === 'object' && entry['kind'] !== 'flag' && String(entry['update'] ?? '').trim() === '' ? [String(entry['key'] ?? entry['name'] ?? '?')] : []))
    if (silent.length > 0) throw new InvalidEditProblems(silent.map(key => `${key}: say when and how it changes, in the field "update" (for example "rises by 1 when the town hears good news"): a tracked value without that rule moves for nothing`))
  }
  await FILES[kind].write(world, document, options)
}
