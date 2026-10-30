import { COMPARISONS } from 'dsh-roleplay-model'
import { parseTriggersFile } from '../triggers/load.ts'
import { commandFlagKey, type StoryCommand } from '../../shared/commands.ts'
import { parseCommandsFile } from '../commands/load.ts'
import { trOf, uniqueKey, type ImportContext } from './run.ts'
import type { NormalizedCard } from '../../shared/import-card.ts'

type Document = Record<string, unknown>

const CASTING_SCHEMA = {
  type: 'object',
  properties: {
    commands: { type: 'array', items: { type: 'object', properties: { word: { type: 'string' }, description: { type: 'string' } }, required: ['word', 'description'], additionalProperties: false } },
    mechanisms: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' }, command: { type: 'string' }, happens: { type: 'string' }, need: { type: 'string' }, text: { type: 'string' },
          options: { type: 'array', items: { type: 'string' } },
        },
        // every field is required (empty when the card says nothing): models leave optional fields out
        required: ['name', 'command', 'happens', 'need', 'text', 'options'],
        additionalProperties: false,
      },
    },
  },
  required: ['commands', 'mechanisms'],
  additionalProperties: false,
} as const

/** A trigger key is ASCII: the name's own letters when it has any, else the mechanism's number. */
const asciiKey = (name: string, number: number): string => {
  const key = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)
  return key === '' ? `casting_${number}` : key
}

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')
const objects = (value: unknown): Document[] => (Array.isArray(value) ? value.filter((entry): entry is Document => typeof entry === 'object' && entry !== null) : [])
/** The most of the card's casting passages one request reads. */
const BUDGET_CHARS = 14_000
const MAX_MECHANISMS = 8

export interface Casting {
  commands: Document[]
  triggers: Document[]
  notes: string[]
}

/**
 * The documents of `commands.json` and `triggers.json` an answer describes: a command raises the flag its trigger waits on, a happening is a statement the story is judged
 * against, and the trigger has the world author make the person (a drawn option when the card gives a list). What does not read as a valid file is left out, with a note.
 */
/** Whether the passages name `word` as something the player types: after a slash, or alone in brackets or quotes. A word that only turns up in the card's sentences is a topic, not a command. */
export function namedAsCommand(word: string, passages: readonly string[]): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`/${escaped}(?![\\p{L}\\p{N}_])|[「『【\\[“"'‘（(]\\s*/?${escaped}\\s*[」』】\\]”"'’）)]`, 'iu').test(passages.join('\n'))
}

export function castingDocuments(answer: Document, passages: readonly string[] = []): Casting {
  const notes: string[] = []
  const commands = objects(answer['commands']).map(entry => ({ word: str(entry['word']).toLowerCase().replace(/^\//, ''), description: str(entry['description']) })).filter(entry => entry.word !== '' && entry.description !== '' && namedAsCommand(entry.word, passages))
  // a flag's name is ASCII, so a word in another script is named by its place in the list
  const keyed = commands.map((entry, index) => ({ ...entry, key: /^[a-z][a-z0-9_]{0,29}$/.test(entry.word) ? entry.word : `word_${index + 1}` }))
  const parsedCommands = parseCommandsFile(JSON.stringify({ commands: keyed.map(entry => ({ word: entry.word, key: entry.key, description: entry.description })) }))
  const usable: StoryCommand[] = parsedCommands.ok ? parsedCommands.value : []
  if (!parsedCommands.ok) notes.push(`commands not carried: ${parsedCommands.issues.map(issue => `${issue.path} ${issue.message}`.trim()).join('; ')}`)
  const taken = new Set<string>()
  const triggers: Document[] = []
  for (const mechanism of objects(answer['mechanisms']).slice(0, MAX_MECHANISMS)) {
    const name = str(mechanism['name'])
    const command = usable.find(entry => entry.word === str(mechanism['command']).toLowerCase())
    const happens = str(mechanism['happens']) || (command === undefined && str(mechanism['command']) !== '' ? str(mechanism['name']) : '')
    const need = str(mechanism['need'])
    const options = Array.isArray(mechanism['options']) ? (mechanism['options'] as unknown[]).map(str).filter(option => option !== '') : []
    let words = str(mechanism['text']) || need
    if (name === '' || need === '' || (command === undefined && happens === '')) { notes.push(`casting not carried: "${name || 'unnamed'}" has no reason to start it`); continue }
    if (options.length > 0 && !words.includes('[draw]')) words = `${words} [draw]`
    if (options.length === 0) words = words.replaceAll('[draw]', '').trim()
    const when = command === undefined ? { type: 'judged', text: happens } : { type: 'variable', variable: commandFlagKey(command), op: COMPARISONS[0], value: true }
    triggers.push({
      key: uniqueKey(asciiKey(name, triggers.length + 1), taken), name, when, repeat: true,
      effects: [{ type: 'beat', dispatch: 'author', need, text: words, ...(options.length === 0 ? {} : { draw: options }) }],
    })
  }
  const parsedTriggers = parseTriggersFile(JSON.stringify(triggers))
  if (!parsedTriggers.ok) {
    notes.push(`casting not carried: ${parsedTriggers.issues.map(issue => `${issue.path} ${issue.message}`.trim()).join('; ')}`)
    return { commands: [], triggers: [], notes }
  }
  const used = new Set(triggers.flatMap(trigger => ((trigger['when'] as Document)['variable'] === undefined ? [] : [String((trigger['when'] as Document)['variable'])])))
  return { commands: usable.filter(command => used.has(commandFlagKey(command))).map(command => ({ ...command })), triggers, notes }
}

/** Turns what the card says about making people up into the world's commands and the triggers that have the world author make them. */
export async function extractCasting(ctx: ImportContext, card: NormalizedCard, passages: readonly string[]): Promise<Casting> {
  if (passages.length === 0) return { commands: [], triggers: [], notes: [] }
  ctx.say('turning the casting guidance into commands and triggers')
  try {
    const tr = trOf(ctx)
    const prompt = `${tr('Card: {name}', { name: card.name })}\n\n${tr('Passages about making people up:')}\n\n${passages.join('\n\n---\n\n').slice(0, BUDGET_CHARS)}`
    const answer = await ctx.run<Document>({
      persona: ctx.text('import/casting', { rules: ctx.text('import/common-rules') }),
      maxTokens: 3000,
      prompt,
      result: CASTING_SCHEMA as never,
      check: value => { const made = castingDocuments(value, passages); return made.triggers.length === 0 && made.notes.length > 0 ? made.notes.join('; ') : undefined },
    })
    return castingDocuments(answer, passages)
  } catch (error) {
    return { commands: [], triggers: [], notes: [`the casting guidance was not turned into commands and triggers: ${error instanceof Error ? error.message : String(error)}`] }
  }
}
