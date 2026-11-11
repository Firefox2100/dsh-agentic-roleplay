import { InvalidEditProblems } from './world-state.ts'

/** The slash commands of a world as `commands.json` writes them. */
export interface CommandsDocument {
  commands: { word: string; description: string; key?: string }[]
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The commands as the browser sends them. Whether the words are acceptable (letters, not one the game uses, not repeated) is checked as the file is read.
 * @throws {InvalidEditProblems} naming every field that has the wrong shape.
 */
export function parseCommandsEdit(value: unknown): CommandsDocument {
  const problems: string[] = []
  if (!isObject(value) || !Array.isArray(value['commands'])) throw new InvalidEditProblems(['the commands must be { commands: [...] }'])
  const commands = value['commands'].map((entry, index): CommandsDocument['commands'][number] => {
    const at = `commands[${index}]`
    if (!isObject(entry)) { problems.push(`${at} must be an object`); return { word: '', description: '' } }
    for (const key of Object.keys(entry)) if (!['word', 'description', 'key'].includes(key)) problems.push(`${at}.${key} is not a field of a command`)
    for (const key of ['word', 'description'] as const) if (typeof entry[key] !== 'string') problems.push(`${at}.${key} must be text`)
    if (entry['key'] !== undefined && typeof entry['key'] !== 'string') problems.push(`${at}.key must be text`)
    const text = (field: unknown): string => (typeof field === 'string' ? field.trim() : '')
    return { word: text(entry['word']).replace(/^\//, ''), description: text(entry['description']), ...(text(entry['key']) === '' ? {} : { key: text(entry['key']) }) }
  })
  if (problems.length > 0) throw new InvalidEditProblems(problems)
  return { commands }
}
