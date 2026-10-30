import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { CatalogueError } from './errors.ts'
import { atomicWriteJson } from '../atomic-write.ts'

export const ORIGIN_FILE = '.catalogue.json'
const MAX_LISTED_CHANGES = 12

/** Where a world in the person's folder came from. A card's conversion is not reproducible, so it is recorded only to say it happened. */
export type WorldOrigin = ReleaseOrigin | CardOrigin

export interface Provenance {
  /** The catalogue's API root as it was when the world was installed. */
  root: string
  resourceId: string
  versionId: string
  version: string
}

export interface ReleaseOrigin extends Provenance {
  kind: 'release'
  /** SHA-256 of every file of the world as it stood after installing; what "changed on this computer" is measured against. */
  files: Record<string, string>
}

export interface CardOrigin extends Provenance {
  kind: 'card'
}

export interface Changes {
  changed: string[]
  added: string[]
  removed: string[]
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The origin recorded in a world's folder, or nothing when it has none. @throws {CatalogueError} when the record is damaged. */
export async function readOrigin(directory: string): Promise<WorldOrigin | undefined> {
  let text: string
  try { text = await readFile(join(directory, ORIGIN_FILE), 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  const damaged = (): CatalogueError => new CatalogueError(`${ORIGIN_FILE} in ${directory} is damaged`, 'invalid')
  let value: unknown
  try { value = JSON.parse(text) } catch { throw damaged() }
  if (!isRecord(value)) throw damaged()
  const { kind, root, resourceId, versionId, version, files } = value
  if ((kind !== 'release' && kind !== 'card') || typeof root !== 'string' || typeof resourceId !== 'string' || typeof versionId !== 'string' || typeof version !== 'string') throw damaged()
  if (kind === 'card') return { kind, root, resourceId, versionId, version }
  if (!isRecord(files) || !Object.values(files).every(hash => typeof hash === 'string')) throw damaged()
  return { kind, root, resourceId, versionId, version, files: files as Record<string, string> }
}

export async function writeOrigin(directory: string, origin: WorldOrigin): Promise<void> {
  const file = join(directory, ORIGIN_FILE)
  await atomicWriteJson(file, origin, { indent: 2 })
}

/** SHA-256 of every file in a world folder; entries whose names start with a dot (this record, the trash, import state) are not the world's own. */
export async function hashWorld(directory: string, skip: (path: string) => boolean = () => false): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {}
  const walk = async (relative: string): Promise<void> => {
    for (const entry of await readdir(join(directory, relative), { withFileTypes: true })) {
      if (relative === '' && entry.name.startsWith('.')) continue
      const path = relative === '' ? entry.name : `${relative}/${entry.name}`
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile() && !skip(path)) hashes[path] = createHash('sha256').update(await readFile(join(directory, path))).digest('hex')
    }
  }
  await walk('')
  return hashes
}

export function compare(recorded: Record<string, string>, current: Record<string, string>): Changes {
  return {
    changed: Object.keys(recorded).filter(path => current[path] !== undefined && current[path] !== recorded[path]),
    added: Object.keys(current).filter(path => recorded[path] === undefined),
    removed: Object.keys(recorded).filter(path => current[path] === undefined),
  }
}

export const isUnchanged = (changes: Changes): boolean => changes.changed.length + changes.added.length + changes.removed.length === 0

/** The differences as short lines for a person to read, capped. */
export function describeChanges(changes: Changes): string[] {
  const lines = [...changes.changed.map(path => `changed: ${path}`), ...changes.added.map(path => `added: ${path}`), ...changes.removed.map(path => `removed: ${path}`)]
  return lines.length <= MAX_LISTED_CHANGES ? lines : [...lines.slice(0, MAX_LISTED_CHANGES), `and ${lines.length - MAX_LISTED_CHANGES} more`]
}

/** How a world's files compare with the release it came from: the differences, or `unverified` when no record of the release exists. */
export async function localChanges(directory: string): Promise<Changes | 'unverified'> {
  const origin = await readOrigin(directory)
  if (origin?.kind !== 'release') return 'unverified'
  return compare(origin.files, await hashWorld(directory))
}
