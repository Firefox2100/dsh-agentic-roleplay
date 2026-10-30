import { join } from 'node:path'
import type { VariableDefinitionInput } from 'dsh-roleplay-model'
import type { WorldProblem } from '../../shared/worlds.ts'
import { errorMessage } from '../errors.ts'
import { readDocument } from '../read-document.ts'
import { commandFlagKey } from '../../shared/commands.ts'
import { Reader, type Issue, type ParseResult } from '../validation.ts'

export const COMMANDS_FILE_NAME = 'commands.json'
export const MAX_COMMANDS = 20
/** The words the game itself uses after a slash. */
const RESERVED = new Set(['ooc', 'roll'])
const WORD = /^[\p{L}\p{N}_]{1,30}$/u
const KEY = /^[a-z][a-z0-9_]{0,29}$/

/** A word the player may type after a slash to do something the world has set up for it: it raises a flag the world's triggers wait on. */
export interface CommandDefinition {
  word: string
  /** The name of the variable (`command_<key>`) raised while the command is used; the word itself when that is plain lowercase ASCII. */
  key: string
  description: string
}

export const commandVariable = commandFlagKey

/** The flag a command raises, as the world declares its variables. */
export const commandFlag = (command: CommandDefinition): VariableDefinitionInput => ({
  key: commandVariable(command), name: `/${command.word}`, kind: 'flag', subject: 'world', visibility: 'hidden', default: false, description: command.description,
})

/** Read `commands.json`: the slash commands a world defines (docs/world-format.md). */
export function parseCommandsFile(text: string): ParseResult<CommandDefinition[]> {
  const issues: Issue[] = []
  const reader = Reader.fromJson(text, issues)
  if (reader === undefined) return { ok: false, issues }
  const commands = reader.objects('commands').flatMap((entry): CommandDefinition[] => {
    const word = entry.string('word', { required: true })?.trim().toLowerCase()
    const description = entry.string('description', { required: true })
    const given = entry.string('key')
    if (word === undefined || description === undefined) return []
    if (!WORD.test(word)) entry.fail('word', 'must be letters, digits or underscores, at most 30')
    if (RESERVED.has(word)) entry.fail('word', `"${word}" is used by the game itself`)
    const key = given ?? (KEY.test(word) ? word : undefined)
    if (key === undefined) entry.fail('key', 'is required when the word is not plain lowercase ASCII: the name its flag is given (letters, digits, underscores)')
    else if (!KEY.test(key)) entry.fail('key', 'must be lowercase ASCII letters, digits and underscores, starting with a letter')
    return key === undefined ? [] : [{ word, key, description }]
  })
  const seen = new Set<string>()
  for (const command of commands) {
    if (seen.has(command.word) || seen.has(`key:${command.key}`)) reader.fail('commands', `"${command.word}" is defined twice`)
    seen.add(command.word)
    seen.add(`key:${command.key}`)
  }
  if (commands.length > MAX_COMMANDS) reader.fail('commands', `a world has at most ${MAX_COMMANDS} commands`)
  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: commands }
}

/** The commands of a world: an optional `<world>/commands.json`. */
export async function loadCommands(worldDir: string): Promise<{ commands: CommandDefinition[]; problems: WorldProblem[] }> {
  const result: { commands: CommandDefinition[]; problems: WorldProblem[] } = { commands: [], problems: [] }
  const file = join(worldDir, COMMANDS_FILE_NAME)
  try {
    result.commands = (await readDocument(file, parseCommandsFile, result.problems)) ?? []
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') result.problems.push({ path: file, message: errorMessage(error) })
  }
  return result
}
