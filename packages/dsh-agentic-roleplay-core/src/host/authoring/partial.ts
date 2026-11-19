import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { InvalidEditProblems } from '../../shared/world-state.ts'
import { PLOTS_FILE_NAME, parsePlotsFile } from '../plots/load.ts'
import { readTriggerDocuments, writeTriggerDocument } from '../triggers/files.ts'
import type { WorldParts } from '../triggers/check.ts'
import { editWorldPlots, type EditableWorld } from '../worlds/world-editor.ts'
import { mergeChanges } from './documents.ts'
import { readWorldFile, writeWorldFile, type WorldFileKind } from './world-files.ts'

type Entry = Record<string, unknown>
const isEntry = (value: unknown): value is Entry => typeof value === 'object' && value !== null && !Array.isArray(value)

const SHOWN_KEYS = 12

function needChanges(changes: unknown): void {
  if (!isEntry(changes) || Object.keys(changes).length === 0) throw new InvalidEditProblems(['changes must be an object holding the fields to change (null removes a field)'])
}

/** The refusal for a key that names nothing in a list: it lists the keys there are. */
function noEntry(what: string, key: string, keys: readonly string[]): InvalidEditProblems {
  const shown = keys.slice(0, SHOWN_KEYS).join(', ')
  return new InvalidEditProblems([`there is no ${what} "${key}": ${keys.length === 0 ? `the world has no ${what} yet` : `the keys are: ${shown}${keys.length > SHOWN_KEYS ? `, and ${keys.length - SHOWN_KEYS} more` : ''}`}`])
}

/** Changes some fields of one entry of a list by the field that names it, leaving every other entry as it is. */
function changeEntry(list: readonly unknown[], idOf: (entry: Entry) => string | undefined, what: string, key: string, changes: unknown): unknown[] {
  needChanges(changes)
  const entries = list.filter(isEntry)
  const at = list.findIndex(entry => isEntry(entry) && idOf(entry) === key)
  if (at < 0) throw noEntry(what, key, entries.flatMap(entry => idOf(entry) ?? []))
  return list.map((entry, index) => (index === at ? mergeChanges(entry, changes) : entry))
}

/** Changes some fields of one plot and checks the whole list as a replacement is checked. */
export async function updatePlot(world: EditableWorld, key: string, changes: unknown, options: { dryRun?: boolean } = {}): Promise<void> {
  let stored: unknown
  try { stored = JSON.parse((await readFile(join(world.directory, PLOTS_FILE_NAME), 'utf8')).replace(/^\uFEFF/, '')) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    stored = []
  }
  const plots = changeEntry(Array.isArray(stored) ? stored : [], entry => (typeof entry['id'] === 'string' ? entry['id'] : undefined), 'plot', key, changes)
  const parsed = parsePlotsFile(JSON.stringify(plots))
  if (!parsed.ok) throw new InvalidEditProblems(parsed.issues.map(issue => `${issue.path}: ${issue.message}`))
  await editWorldPlots(world, { plots: parsed.value }, options)
}

/** Changes some fields of one trigger and checks it as a replacement is checked. */
export async function updateTrigger(directory: string, parts: WorldParts, key: string, changes: unknown, options: { dryRun?: boolean } = {}): Promise<void> {
  needChanges(changes)
  const documents = await readTriggerDocuments(directory)
  const stored = documents.find(entry => entry['key'] === key)
  if (stored === undefined) throw noEntry('trigger', key, documents.flatMap(entry => (typeof entry['key'] === 'string' ? entry['key'] : [])))
  await writeTriggerDocument(directory, parts, key, mergeChanges(stored, changes), options)
}

const LISTS: Record<WorldFileKind, { what: string; list: (document: unknown) => unknown[]; put: (document: unknown, list: unknown[]) => unknown; id: (entry: Entry) => string | undefined }> = {
  variables: { what: 'variable', list: document => (Array.isArray(document) ? document : []), put: (_, list) => list, id: entry => (typeof entry['key'] === 'string' ? entry['key'] : undefined) },
  dice: { what: 'check', list: document => (isEntry(document) && Array.isArray(document['checks']) ? document['checks'] : []), put: (document, list) => ({ ...(isEntry(document) ? document : {}), checks: list }), id: entry => (typeof entry['key'] === 'string' ? entry['key'] : undefined) },
  commands: { what: 'command', list: document => (isEntry(document) && Array.isArray(document['commands']) ? document['commands'] : []), put: (document, list) => ({ ...(isEntry(document) ? document : {}), commands: list }), id: entry => (typeof entry['key'] === 'string' ? entry['key'] : typeof entry['word'] === 'string' ? entry['word'] : undefined) },
  calendar: { what: 'holiday', list: document => (isEntry(document) && Array.isArray(document['holidays']) ? document['holidays'] : []), put: (document, list) => ({ ...(isEntry(document) ? document : {}), holidays: list }), id: entry => (typeof entry['id'] === 'string' ? entry['id'] : undefined) },
}

/** Changes some fields of one entry of a whole-world file (a variable, a dice check, a command or a holiday) and checks the whole file as a replacement is checked. */
export async function updateWorldFileEntry(world: EditableWorld, kind: WorldFileKind, key: string, changes: unknown, options: { dryRun?: boolean } = {}): Promise<void> {
  const shape = LISTS[kind]
  const document = await readWorldFile(world.directory, kind)
  const list = changeEntry(shape.list(document), shape.id, shape.what, key, changes)
  await writeWorldFile(world, kind, shape.put(document, list), options)
}

/** The keys of the entries of a whole-world file's document, as `update_world_file` names them. */
export function worldFileKeys(kind: WorldFileKind, document: unknown): string[] {
  const shape = LISTS[kind]
  return shape.list(document).filter(isEntry).flatMap(entry => shape.id(entry) ?? [])
}
