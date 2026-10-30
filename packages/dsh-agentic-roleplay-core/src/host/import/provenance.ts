import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWriteJson } from '../atomic-write.ts'
import { IMPORT_FOLDER } from './store.ts'
import type { ImportReport } from './finish.ts'

const FILE = 'provenance.json'
export const PROVENANCE_SCHEMA = 'dsh-roleplay-import/v1'

export interface ProvenanceEntry {
  at: string
  kind: 'import' | 'update'
  /** The name of the card as the importer read it, and a hash of what it read, so a later card can be told from this one. */
  card: { name: string; sha256: string }
  /** Empty when the step did not know it. */
  language: string
  /** The counts of what the import wrote; an update leaves them out, the world being edited by then. */
  counts?: ImportReport['counts']
  notes?: number
}

export interface Provenance {
  schema: typeof PROVENANCE_SCHEMA
  history: ProvenanceEntry[]
}

/** The import record of a world, or nothing for a world imported before records were kept. */
export async function readProvenance(directory: string): Promise<Provenance | undefined> {
  let text: string
  try { text = await readFile(join(directory, IMPORT_FOLDER, FILE), 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  const value = JSON.parse(text) as Partial<Provenance>
  if (value.schema !== PROVENANCE_SCHEMA || !Array.isArray(value.history)) throw new Error(`${FILE} is not an import record this version reads`)
  return value as Provenance
}

/** Adds one line to the world's import record: what card it came from and, for an import, what was written. */
export async function recordProvenance(directory: string, entry: Omit<ProvenanceEntry, 'at' | 'card'> & { card: { name: string } }, cardJson: string): Promise<void> {
  const earlier = await readProvenance(directory)
  const line: ProvenanceEntry = { ...entry, at: new Date().toISOString(), card: { name: entry.card.name, sha256: createHash('sha256').update(cardJson).digest('hex') } }
  await atomicWriteJson(join(directory, IMPORT_FOLDER, FILE), { schema: PROVENANCE_SCHEMA, history: [...earlier?.history ?? [], line] } satisfies Provenance)
}
