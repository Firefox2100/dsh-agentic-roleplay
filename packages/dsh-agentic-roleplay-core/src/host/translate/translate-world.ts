import { randomUUID } from 'node:crypto'
import { cp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, sep } from 'node:path'
import { InvalidWorldError } from '../sessions/errors.ts'
import type { WorldCatalog } from '../worlds/catalog.ts'
import { loadValidatedWorld } from '../worlds/validated-world.ts'
import { mapLimit, type ChildJob, type ImportContext } from '../import/run.ts'
import { LANGUAGE_NAMES, textLanguage, type StoryLanguage } from './language.ts'
import { recurringTerms, usesTerm } from './terms.ts'
import { leavesOf, readWorldDocuments, setLeaf, type Leaf, type WorldDocument } from './prose.ts'

/** What is not carried over to a translation: the removed things of the editor and the card import's working files. */
const NOT_COPIED = new Set(['.trash', '.import', '.checks'])

const TERMS_PER_JOB = 40
const TEXTS_PER_JOB = 30
const CHARS_PER_JOB = 5000
const GLOSSARY_SHOWN = 60
/** A text with fewer letters than this is too short to check which language it came out in. */
const CHECKED_LETTERS = 40
/** A name shorter than this is too likely to be an ordinary word to be held to the glossary. */
const MIN_TERM = 4

export { LANGUAGE_NAMES }

export interface TranslationReport {
  worldId: string
  name: string
  folder: string
  documents: number
  texts: number
  names: number
  /** What the translated world's check found wrong; empty when it would start. */
  problems: string[]
  /** The world's own prompt files that were written in the new language, as ids. */
  prompts: string[]
  /** Parts of the world that were copied as they were, because they are not words of the story. */
  copiedAsIs: string[]
}

/** How the two languages are called in the prompts' own language. */
type Names = { from: string; to: string }

export class TranslationRefusedError extends Error {}

const STRINGS = { type: 'array', items: { type: 'string' } } as const

const GLOSSARY_SCHEMA = {
  type: 'object',
  properties: {
    terms: {
      type: 'array',
      items: { type: 'object', properties: { source: { type: 'string' }, target: { type: 'string' } }, required: ['source', 'target'], additionalProperties: false },
      description: 'One entry for each name given, in the same order, with the source exactly as given.',
    },
  },
  required: ['terms'],
  additionalProperties: false,
} as const

const TEXTS_SCHEMA = {
  type: 'object',
  properties: { translations: { ...STRINGS, description: 'The translation of each text, in the order given.' } },
  required: ['translations'],
  additionalProperties: false,
} as const

const BRACED = /\$?\{[^{}]*\}/g
const braces = (text: string): string => (text.match(BRACED) ?? []).sort().join('\u0000')
const letters = (text: string): number => text.match(/\p{L}/gu)?.length ?? 0

/** The language the world is written in, from the words of all its files; nothing when there are too few to tell. */
export function languageOfDocuments(documents: readonly WorldDocument[]): StoryLanguage | undefined {
  return textLanguage(documents.flatMap(entry => leavesOf(entry.kind, entry.document).map(leaf => leaf.text)).join('\n'))
}

function batches<T>(items: readonly T[], size: (item: T) => number, maxItems: number, maxSize: number): T[][] {
  const out: T[][] = []
  let current: T[] = []
  let used = 0
  for (const item of items) {
    if (current.length > 0 && (current.length >= maxItems || used + size(item) > maxSize)) { out.push(current); current = []; used = 0 }
    current.push(item)
    used += size(item)
  }
  if (current.length > 0) out.push(current)
  return out
}

/** Why a set of translations cannot be used, or nothing. A text left in the language it was written in is not a translation. */
function problemWith(sources: readonly string[], from: StoryLanguage, translations: readonly string[], glossary: ReadonlyMap<string, string>): string | undefined {
  if (translations.length !== sources.length) return `${sources.length} texts were given and ${translations.length} translations came back: give exactly one for each, in order`
  for (const [index, source] of sources.entries()) {
    const text = translations[index]!
    if (text.trim() === '') return `translation ${index + 1} is empty`
    if (braces(source) !== braces(text)) return `translation ${index + 1} must keep the text in curly braces exactly as it is: ${(source.match(BRACED) ?? []).join(' ')}`
    if (letters(source) >= CHECKED_LETTERS && textLanguage(source) === from && textLanguage(text) === from) return `translation ${index + 1} is still in the original language`
    for (const [term, rendering] of glossary) {
      if (term.length >= MIN_TERM && rendering !== term && !rendering.includes(term) && usesTerm(source, term) && usesTerm(text, term)) return `translation ${index + 1} still has "${term}": the glossary renders it "${rendering}"`
    }
  }
  return undefined
}

async function glossaryOf(ctx: ImportContext, names: readonly string[], vars: Names, known: ReadonlyMap<string, string> = new Map()): Promise<Map<string, string>> {
  const jobs = batches(names, () => 1, TERMS_PER_JOB, TERMS_PER_JOB)
  const parts = await mapLimit(jobs, ctx.concurrency, async (terms) => {
    const job: ChildJob<{ terms: { source: string; target: string }[] }> = {
      persona: ctx.text('translate/glossary', vars),
      prompt: JSON.stringify({ known: Object.fromEntries([...known].filter(([source]) => terms.some(term => term.toLowerCase().includes(source.toLowerCase())))), names: terms }),
      result: GLOSSARY_SCHEMA as never,
      check: (value) => {
        if (value.terms.length !== terms.length) return `${terms.length} names were given and ${value.terms.length} came back: one for each, in order`
        const wrong = terms.findIndex((term, index) => value.terms[index]!.source !== term || value.terms[index]!.target.trim() === '')
        return wrong === -1 ? undefined : `entry ${wrong + 1} must repeat "${terms[wrong]}" exactly and have a translation`
      },
    }
    return (await ctx.run(job)).terms
  })
  return new Map(parts.flat().map(term => [term.source, term.target.trim()]))
}

async function translated(ctx: ImportContext, texts: readonly string[], glossary: ReadonlyMap<string, string>, from: StoryLanguage, vars: Names): Promise<string[]> {
  const parts = await mapLimit(batches(texts, text => text.length, TEXTS_PER_JOB, CHARS_PER_JOB), ctx.concurrency, async (group) => {
    const haystack = group.join('\n').toLowerCase()
    const shown = [...glossary].filter(([source]) => haystack.includes(source.toLowerCase())).slice(0, GLOSSARY_SHOWN)
    const relevant = new Map(shown)
    const job: ChildJob<{ translations: string[] }> = {
      persona: ctx.text('translate/document', vars),
      prompt: JSON.stringify({ glossary: Object.fromEntries(shown), texts: group.map((text, index) => ({ n: index + 1, text })) }),
      result: TEXTS_SCHEMA as never,
      check: value => problemWith(group, from, value.translations, relevant),
    }
    return (await ctx.run(job)).translations
  })
  return parts.flat()
}

async function freeFolder(directory: string, suffix: string): Promise<string> {
  for (let n = 1; ; n += 1) {
    const candidate = join(dirname(directory), `${basename(directory)} ${suffix}${n === 1 ? '' : ` ${n}`}`)
    try { await stat(candidate) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return candidate; throw error }
  }
}

/** The ids of the Markdown prompt files under a world's prompt folder for one language (`roleplay/style`), or none when it has none. */
async function promptIds(folder: string, prefix = ''): Promise<string[]> {
  let entries
  try { entries = await readdir(join(folder, prefix), { withFileTypes: true }) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
  const ids: string[] = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const id = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) ids.push(...await promptIds(folder, id))
    else if (entry.isFile() && entry.name.endsWith('.md')) ids.push(id.slice(0, -'.md'.length))
  }
  return ids
}

async function listedIn(directory: string, names: readonly string[]): Promise<string[]> {
  const present = new Set(await readdir(directory))
  return names.filter(name => present.has(name))
}

/**
 * Makes a copy of a world in another language, next to it: the names first, so that every file calls each person, place and thing the same, then the words of each file.
 * The original is never changed. The copy gets an id of its own and is checked as a story start would check it.
 */
export async function translateWorld(ctx: ImportContext, worlds: WorldCatalog, source: { directory: string }, to: StoryLanguage, told: StoryLanguage): Promise<TranslationReport> {
  const documents = await readWorldDocuments(source.directory)
  const from = languageOfDocuments(documents)
  if (from === undefined) throw new TranslationRefusedError('there is too little text in this world to tell which language it is written in')
  if (from === to) throw new TranslationRefusedError(`this world is already written in ${LANGUAGE_NAMES[to].en}`)

  const vars: Names = { from: LANGUAGE_NAMES[from][told], to: LANGUAGE_NAMES[to][told] }
  const leaves = documents.map(entry => ({ entry, leaves: leavesOf(entry.kind, entry.document) }))
  const names = [...new Set(leaves.flatMap(item => item.leaves.filter(leaf => leaf.name).map(leaf => leaf.text)))]
  ctx.say(`translating ${names.length} names`)
  const prose = leaves.flatMap(item => item.leaves.filter(leaf => !leaf.name).map(leaf => leaf.text))
  const recurring = from === 'en' ? recurringTerms(names, prose) : []
  const parts = await glossaryOf(ctx, recurring, vars)
  const glossary = await glossaryOf(ctx, names, vars, parts)
  for (const [term, rendering] of parts) glossary.set(term, rendering)

  let texts = 0
  for (const { entry, leaves: own } of leaves) {
    const words = own.filter((leaf): leaf is Leaf => !leaf.name)
    for (const leaf of own.filter(item => item.name)) setLeaf(entry.document, leaf.path, glossary.get(leaf.text) ?? leaf.text)
    if (words.length === 0) continue
    ctx.say(`translating ${entry.file}`)
    const result = await translated(ctx, words.map(leaf => leaf.text), glossary, from, vars)
    for (const [index, leaf] of words.entries()) setLeaf(entry.document, leaf.path, result[index]!)
    texts += words.length
  }

  for (const { entry, leaves: own } of leaves) {
    const document = entry.document as Record<string, unknown>
    if (entry.kind !== 'character' && entry.kind !== 'faction') continue
    const original = own.find(leaf => leaf.name && leaf.path.length === 1 && leaf.path[0] === 'name')?.text
    const aliases = Array.isArray(document['aliases']) ? document['aliases'] as string[] : []
    if (original !== undefined && original !== document['name'] && !aliases.includes(original)) document['aliases'] = [...aliases, original]
  }

  const own = await promptIds(join(source.directory, 'prompts', from))
  const present = new Set(await promptIds(join(source.directory, 'prompts', to)))
  const owed = own.filter(prompt => !present.has(prompt))
  const written: { id: string; text: string }[] = []
  if (owed.length > 0) {
    ctx.say(`translating ${owed.length} prompt files`)
    const sources = await Promise.all(owed.map(prompt => readFile(join(source.directory, 'prompts', from, `${prompt}.md`), 'utf8')))
    const result = await translated(ctx, sources, glossary, from, vars)
    for (const [index, prompt] of owed.entries()) written.push({ id: prompt, text: result[index]! })
  }

  const id = randomUUID()
  const destination = await freeFolder(source.directory, to)
  await cp(source.directory, destination, { recursive: true, filter: path => !NOT_COPIED.has(relative(source.directory, path).split(sep)[0]!) })
  for (const entry of documents) {
    const document = entry.kind === 'world' ? (({ id: _old, ...rest }) => ({ id, ...rest }))(entry.document as Record<string, unknown>) : entry.document
    await writeFile(join(destination, entry.file), `${JSON.stringify(document, null, 2)}\n`)
  }

  for (const prompt of written) {
    const file = join(destination, 'prompts', to, `${prompt.id}.md`)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, prompt.text.endsWith('\n') ? prompt.text : `${prompt.text}\n`)
  }

  const payload = await worlds.list({ refresh: true })
  const made = payload.worlds.find(world => world.id === id)
  if (made === undefined) throw new Error(`the translated world was written to ${destination} but the catalogue does not list it: ${payload.problems.map(problem => problem.message).join('; ')}`)
  const record = await worlds.find(id)
  const problems: string[] = []
  if (record !== undefined) {
    try { await loadValidatedWorld(record) } catch (error) {
      if (!(error instanceof InvalidWorldError)) throw error
      problems.push(...error.problems.map(problem => `${relative(destination, problem.path) || '.'}: ${problem.message}`))
    }
  }
  return {
    worldId: id, name: made.name, folder: basename(destination), documents: documents.length, texts, names: names.length + recurring.length, problems, prompts: written.map(prompt => prompt.id),
    copiedAsIs: await listedIn(source.directory, ['ui', 'images', 'media']),
  }
}
