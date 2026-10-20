import { parseSwitchboard, type Switchboard } from './settings.ts'
import { InvalidEditProblems } from './world-state.ts'

/** The most alternate openings a world may offer, and the longest one. */
export const MAX_ALTERNATE_OPENINGS = 30
export const MAX_OPENING_CHARS = 20_000

/** Another way the story can begin, which the player may choose when starting a session. */
export interface AlternateOpeningText {
  title: string
  text: string
  /** The id of the playable character it is for; empty or absent for any. */
  character?: string
}

/** What a world says about itself, as the editor shows and changes it. */
export interface WorldInfo {
  name: string
  description: string
  tags: string[]
  /** What is not allowed in the world, one short rule each. */
  rules: string[]
  /** The opening message as plain text; empty when the world has none. */
  opening: string
  /** The opening has several parts (narration and lines of characters): it can be read but not edited as text. */
  openingParts: boolean
  authorName: string
  authorUrl: string
  /** An IANA time zone name, or empty. */
  timeZone: string
  /** When the story begins, as written in the file, or empty. */
  startingTime: string
  /** The author's own version label, or empty. */
  version: string
  /** The library preset suggested for stories of this world, or empty. */
  preset: string
  /** The library lorebooks suggested for stories of this world. */
  lorebooks: string[]
  alternateOpenings: AlternateOpeningText[]
  /** The optional tools the world's agents have switched on or off, by kind of agent: only what was chosen, and names this version does not know. */
  tools: Switchboard
}

export type WorldInfoEdit = Partial<Omit<WorldInfo, 'openingParts'>>

const TEXT_FIELDS = ['name', 'description', 'opening', 'authorName', 'authorUrl', 'timeZone', 'startingTime', 'version', 'preset'] as const
const LIST_FIELDS = ['tags', 'rules', 'lorebooks'] as const
export const MAX_WORLD_NAME = 200
export const MAX_WORLD_VERSION = 40

/** Reads a body that came from the browser; every field is checked and each problem is reported. */
export function parseWorldInfoEdit(value: unknown): WorldInfoEdit {
  const problems: string[] = []
  const input = typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
  if (input === undefined) throw new InvalidEditProblems(['the changes must be an object'])
  const edit: Record<string, unknown> = {}
  for (const key of Object.keys(input)) {
    if (!(TEXT_FIELDS as readonly string[]).includes(key) && !(LIST_FIELDS as readonly string[]).includes(key) && key !== 'alternateOpenings' && key !== 'tools') problems.push(`there is no field "${key}"`)
  }
  for (const key of TEXT_FIELDS) {
    if (input[key] === undefined) continue
    if (typeof input[key] === 'string') edit[key] = input[key].trim()
    else problems.push(`${key} must be text`)
  }
  for (const key of LIST_FIELDS) {
    if (input[key] === undefined) continue
    if (Array.isArray(input[key]) && input[key].every(entry => typeof entry === 'string')) edit[key] = (input[key] as string[]).map(entry => entry.trim()).filter(entry => entry !== '')
    else problems.push(`${key} must be a list of text`)
  }
  if (input['alternateOpenings'] !== undefined) {
    const list = input['alternateOpenings']
    const entries = Array.isArray(list) ? list.map(entry => (typeof entry === 'object' && entry !== null ? entry as Record<string, unknown> : undefined)) : undefined
    if (entries === undefined || entries.some(entry => entry === undefined || typeof entry['text'] !== 'string' || (entry['title'] !== undefined && typeof entry['title'] !== 'string') || (entry['character'] !== undefined && typeof entry['character'] !== 'string'))) problems.push('alternateOpenings must be a list of { title, text, character? }')
    else {
      const kept = entries.map(entry => ({ title: String(entry!['title'] ?? '').trim(), text: String(entry!['text']).trim(), ...(String(entry!['character'] ?? '').trim() === '' ? {} : { character: String(entry!['character']).trim() }) })).filter(entry => entry.text !== '')
      if (kept.length > MAX_ALTERNATE_OPENINGS) problems.push(`there are more than ${MAX_ALTERNATE_OPENINGS} alternate openings`)
      if (kept.some(entry => entry.text.length > MAX_OPENING_CHARS)) problems.push(`an alternate opening is longer than ${MAX_OPENING_CHARS} characters`)
      edit['alternateOpenings'] = kept
    }
  }
  if (input['tools'] !== undefined) {
    const board = parseSwitchboard(input['tools'], 'tools')
    if (typeof board === 'string') problems.push(board)
    else edit['tools'] = board
  }
  if (typeof edit['version'] === 'string' && edit['version'].length > MAX_WORLD_VERSION) problems.push(`the version is longer than ${MAX_WORLD_VERSION} characters`)
  if (edit['name'] === '') problems.push('the world needs a name')
  if (typeof edit['name'] === 'string' && edit['name'].length > MAX_WORLD_NAME) problems.push(`the name is longer than ${MAX_WORLD_NAME} characters`)
  if (problems.length > 0) throw new InvalidEditProblems(problems)
  return edit as WorldInfoEdit
}
