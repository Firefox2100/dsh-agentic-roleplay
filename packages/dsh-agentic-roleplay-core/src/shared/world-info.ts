import { parseSampling, type StorySampling } from './sampling.ts'
import { MAX_OPENING_PARTS, MAX_OPENING_TEXT, parseOpeningParts, partsText, type OpeningPart } from './opening.ts'
import { parseSwitchboard, type Switchboard } from './settings.ts'
import { parseStartQuestionsEdit, type StartQuestion } from './start-questions.ts'
import { InvalidEditProblems } from './world-state.ts'

/** The most alternate openings a world may offer, and the longest one. */
export const MAX_ALTERNATE_OPENINGS = 30
export const MAX_OPENING_CHARS = MAX_OPENING_TEXT
export { MAX_OPENING_PARTS }

/** Another way the story can begin, which the player may choose when starting a session. */
export interface AlternateOpeningText {
  title: string
  /** The words of the opening: all of it when it is plain text, its parts' texts together when it has parts. */
  text: string
  /** The opening as parts (narration and lines of characters), when it is written so; absent for plain narration. */
  parts?: OpeningPart[]
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
  /** The opening as parts (narration and lines of characters), when the file gives it so; absent when it is plain text. `opening` then holds their words together. */
  openingParts?: OpeningPart[]
  authorName: string
  authorUrl: string
  /** An IANA time zone name, or empty. */
  timeZone: string
  /** When the story begins, as written in the file, or empty. */
  startingTime: string
  /** The author's own version label, or empty. */
  version: string
  /** How this world's stories ask their models; only what the file sets. */
  sampling: StorySampling
  /** The language stories of this world are played in by default, as a tag (`ja`), or empty to follow the person's interface language. */
  language: string
  /** The library preset suggested for stories of this world, or empty. */
  preset: string
  /** The library lorebooks suggested for stories of this world. */
  lorebooks: string[]
  alternateOpenings: AlternateOpeningText[]
  /** What the start dialog asks before a story begins, and what each answer changes. */
  startQuestions: StartQuestion[]
  /** The optional tools the world's agents have switched on or off, by kind of agent: only what was chosen, and names this version does not know. */
  tools: Switchboard
  /** Whether stories of this world go on while their player is away (off unless the world says so). */
  autonomy: boolean
}

export type WorldInfoEdit = Partial<WorldInfo>

const TEXT_FIELDS = ['name', 'description', 'opening', 'authorName', 'authorUrl', 'timeZone', 'startingTime', 'version', 'language', 'preset'] as const
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
    if (!(TEXT_FIELDS as readonly string[]).includes(key) && !(LIST_FIELDS as readonly string[]).includes(key) && key !== 'alternateOpenings' && key !== 'openingParts' && key !== 'startQuestions' && key !== 'tools' && key !== 'sampling' && key !== 'autonomy') problems.push(`there is no field "${key}"`)
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
  if (input['openingParts'] !== undefined) {
    if (input['opening'] !== undefined) problems.push('give the opening as text or as parts, not both')
    const parts = parseOpeningParts(input['openingParts'], 'openingParts', problems)
    if (parts !== undefined) edit['openingParts'] = parts
  }
  if (input['alternateOpenings'] !== undefined) {
    const list = input['alternateOpenings']
    const entries = Array.isArray(list) ? list.map(entry => (typeof entry === 'object' && entry !== null ? entry as Record<string, unknown> : undefined)) : undefined
    const kept: AlternateOpeningText[] = []
    if (entries === undefined) problems.push('alternateOpenings must be a list of { title, text or parts, character? }')
    else {
      for (const [index, entry] of entries.entries()) {
        const at = `alternateOpenings[${index}]`
        if (entry === undefined) { problems.push(`${at} must be an object`); continue }
        if ((entry['title'] !== undefined && typeof entry['title'] !== 'string') || (entry['character'] !== undefined && typeof entry['character'] !== 'string')) { problems.push(`${at}: title and character must be text`); continue }
        const title = String(entry['title'] ?? '').trim()
        const character = String(entry['character'] ?? '').trim()
        const named = character === '' ? {} : { character }
        if (entry['parts'] !== undefined) {
          if (entry['text'] !== undefined) problems.push(`${at}: give the opening as text or as parts, not both`)
          const parts = parseOpeningParts(entry['parts'], `${at}.parts`, problems)
          if (parts !== undefined && parts.length > 0) kept.push({ title, text: partsText(parts), parts, ...named })
          continue
        }
        if (typeof entry['text'] !== 'string') { problems.push(`${at}.text must be text`); continue }
        const text = entry['text'].trim()
        if (text !== '') kept.push({ title, text, ...named })
      }
      if (kept.length > MAX_ALTERNATE_OPENINGS) problems.push(`there are more than ${MAX_ALTERNATE_OPENINGS} alternate openings`)
      if (kept.some(entry => entry.text.length > MAX_OPENING_CHARS)) problems.push(`an alternate opening is longer than ${MAX_OPENING_CHARS} characters`)
      edit['alternateOpenings'] = kept
    }
  }
  if (input['startQuestions'] !== undefined) {
    const questions = parseStartQuestionsEdit(input['startQuestions'], problems)
    if (questions !== undefined) edit['startQuestions'] = questions
  }
  if (input['tools'] !== undefined) {
    const board = parseSwitchboard(input['tools'], 'tools')
    if (typeof board === 'string') problems.push(board)
    else edit['tools'] = board
  }
  if (input['autonomy'] !== undefined) { if (typeof input['autonomy'] === 'boolean') edit['autonomy'] = input['autonomy']; else problems.push('autonomy must be true or false') }
  if (input['sampling'] !== undefined) edit['sampling'] = parseSampling(input['sampling'], 'sampling', problems)
  if (typeof edit['version'] === 'string' && edit['version'].length > MAX_WORLD_VERSION) problems.push(`the version is longer than ${MAX_WORLD_VERSION} characters`)
  if (edit['name'] === '') problems.push('the world needs a name')
  if (typeof edit['name'] === 'string' && edit['name'].length > MAX_WORLD_NAME) problems.push(`the name is longer than ${MAX_WORLD_NAME} characters`)
  if (problems.length > 0) throw new InvalidEditProblems(problems)
  return edit as WorldInfoEdit
}
