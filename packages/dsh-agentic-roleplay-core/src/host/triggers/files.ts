import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { TriggerCondition, TriggerDefinition } from 'dsh-roleplay-model'
import { readTriggerDefinition } from '@dsh-agentic-roleplay/state'
import { InvalidEditProblems } from '../../shared/world-state.ts'
import { triggerProblemsOf, type WorldParts } from './check.ts'
import { TRIGGERS_FILE_NAME } from './load.ts'

/** The fields of a trigger in the file; any other is a mistake that would otherwise be dropped without a word. */
const FIELDS = new Set(['key', 'name', 'when', 'effects', 'repeat', 'cooldown_seconds', 'chance', 'priority', 'expires', 'announce'])

type Document = Record<string, unknown>
const isDocument = (value: unknown): value is Document => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The documents of `<world>/triggers.json` as written; none when the file is not there. @throws {InvalidEditProblems} when it is not a list of objects. */
export async function readTriggerDocuments(directory: string): Promise<Document[]> {
  let text: string
  try { text = await readFile(join(directory, TRIGGERS_FILE_NAME), 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  let data: unknown
  try { data = JSON.parse(text.replace(/^﻿/, '')) } catch (error) { throw new InvalidEditProblems([`triggers.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`]) }
  if (!Array.isArray(data) || !data.every(isDocument)) throw new InvalidEditProblems(['triggers.json is not a list of triggers'])
  return data
}

async function writeDocuments(directory: string, documents: readonly Document[]): Promise<void> {
  const file = join(directory, TRIGGERS_FILE_NAME)
  const temporary = join(dirname(file), `.${basename(file)}.${process.pid}.${randomUUID()}.tmp`)
  try {
    const mode = await stat(file).then(value => value.mode, () => undefined)
    await writeFile(temporary, `${JSON.stringify(documents, null, 2)}\n`, mode === undefined ? {} : { mode })
    await rename(temporary, file)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

/** The keys of the triggers a condition waits for. */
function waitsFor(condition: TriggerCondition): string[] {
  switch (condition.type) {
    case 'fired': return [condition.trigger]
    case 'all': case 'any': return condition.conditions.flatMap(waitsFor)
    case 'not': return waitsFor(condition.condition)
    default: return []
  }
}

/**
 * Makes or replaces one trigger of the world, by key, from a complete document in the file format. It is read as a session start reads it, and
 * what it names that the world does not have is refused, with every problem; nothing is written then.
 * @throws {InvalidEditProblems}
 */
export async function writeTriggerDocument(directory: string, parts: WorldParts, key: string, document: unknown): Promise<'created' | 'replaced'> {
  if (!isDocument(document)) throw new InvalidEditProblems(['document must be a JSON object'])
  const unknown = Object.keys(document).filter(field => !FIELDS.has(field))
  if (unknown.length > 0) throw new InvalidEditProblems(unknown.map(field => `"${field}" is not a field of a trigger (${[...FIELDS].join(', ')})`))
  const written: Document = { ...document, key }
  const parsed = readTriggerDefinition(written, 'trigger')
  if ('problems' in parsed) throw new InvalidEditProblems(parsed.problems)
  const documents = await readTriggerDocuments(directory)
  const at = documents.findIndex(entry => entry['key'] === key)
  const others = documents.filter((_, index) => index !== at).flatMap((entry): TriggerDefinition[] => { const read = readTriggerDefinition(entry, 'trigger'); return 'definition' in read ? [read.definition] : [] })
  const problems = triggerProblemsOf(parts, [...others, parsed.definition]).get(key) ?? []
  if (problems.length > 0) throw new InvalidEditProblems(problems)
  await writeDocuments(directory, at < 0 ? [...documents, written] : documents.map((entry, index) => (index === at ? written : entry)))
  return at < 0 ? 'created' : 'replaced'
}

/**
 * Removes one trigger from the world's file, keeping its document in `.trash/triggers` so that it can be put back. A trigger that others wait for
 * cannot be removed.
 * @returns where the document was kept.
 * @throws {InvalidEditProblems}
 */
export async function deleteTriggerDocument(directory: string, key: string): Promise<string> {
  const documents = await readTriggerDocuments(directory)
  const found = documents.find(entry => entry['key'] === key)
  if (found === undefined) throw new InvalidEditProblems([`there is no trigger "${key}"`])
  const waiting = documents.flatMap((entry): string[] => {
    const read = readTriggerDefinition(entry, 'trigger')
    return 'definition' in read && read.definition.key !== key && waitsFor(read.definition.condition).includes(key) ? [read.definition.key] : []
  })
  if (waiting.length > 0) throw new InvalidEditProblems([`${waiting.join(', ')} wait${waiting.length === 1 ? 's' : ''} for "${key}" to fire; change ${waiting.length === 1 ? 'it' : 'them'} first`])
  const trash = join(directory, '.trash', 'triggers')
  await mkdir(trash, { recursive: true })
  const kept = join(trash, `${key}-${Date.now()}-${randomUUID()}.json`)
  await writeFile(kept, `${JSON.stringify(found, null, 2)}\n`, { flag: 'wx' })
  await writeDocuments(directory, documents.filter(entry => entry !== found))
  return kept
}
