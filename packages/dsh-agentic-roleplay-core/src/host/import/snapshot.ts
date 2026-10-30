import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { compare, describeChanges, hashWorld, isUnchanged } from '../catalogue/origin.ts'
import { IMPORT_FOLDER } from './store.ts'
import { atomicWriteJson } from '../atomic-write.ts'

const SNAPSHOT = 'files.json'

/** The pictures of a world are fetched and generated in the background and are not what a card says. */
const notTheCards = (path: string): boolean => path.startsWith('images/')

/** What a world's files were when its import was over; "changed since" is measured against it. */
export async function writeSnapshot(directory: string): Promise<void> {
  const file = join(directory, IMPORT_FOLDER, SNAPSHOT)
  await atomicWriteJson(file, await hashWorld(directory, notTheCards))
}

/** How a world compares with its snapshot: `no` for no change, `yes` with the files, and `unknown` when the import left no snapshot (an older import). */
export async function editsSince(directory: string): Promise<{ edited: 'no' } | { edited: 'yes'; changes: string[] } | { edited: 'unknown' }> {
  let recorded: Record<string, string>
  try { recorded = JSON.parse(await readFile(join(directory, IMPORT_FOLDER, SNAPSHOT), 'utf8')) as Record<string, string> } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { edited: 'unknown' }
    throw error
  }
  const changes = compare(recorded, await hashWorld(directory, notTheCards))
  return isUnchanged(changes) ? { edited: 'no' } : { edited: 'yes', changes: describeChanges(changes) }
}
