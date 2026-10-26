import { readdir, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { isSessionId } from '@dsh-agentic-roleplay/state'
import type { SyncKind } from '../../shared/sync.ts'

/** Folders of the root that are one unit each, whatever they hold. */
export const SHARED_UNITS = ['prompts', 'presets', 'lorebooks', 'avatars', 'ui'] as const

/** The sessions' files belong together (one database, its timeline and snapshots), so a session moves whole; the rest are independent files. */
export type SyncMode = 'whole' | 'files'

export const modeOf = (kind: SyncKind): SyncMode => (kind === 'session' ? 'whole' : 'files')

export function kindOf(unit: string): SyncKind | undefined {
  const [top, name, ...rest] = unit.split('/')
  if (rest.length > 0) return undefined
  if (name === undefined) return (SHARED_UNITS as readonly string[]).includes(top!) ? 'shared' : undefined
  if (top === 'worlds' && !name.startsWith('.') && name !== '') return 'world'
  if (top === 'sessions' && isSessionId(name)) return 'session'
  return undefined
}

async function folders(directory: string): Promise<string[]> {
  try {
    return (await readdir(directory, { withFileTypes: true })).filter(entry => entry.isDirectory() && !entry.name.startsWith('.')).map(entry => entry.name)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

/** The units the root holds. */
export async function localUnits(root: string): Promise<string[]> {
  const shared = (await Promise.all(SHARED_UNITS.map(async name => (await stat(join(root, name)).then(entry => entry.isDirectory(), () => false)) ? name : undefined))).filter(name => name !== undefined)
  const worlds = (await folders(join(root, 'worlds'))).map(name => `worlds/${name}`)
  const sessions = (await folders(join(root, 'sessions'))).filter(isSessionId).map(name => `sessions/${name}`)
  return [...shared, ...worlds, ...sessions]
}

/** A short digest of what a folder holds (names, sizes and times), to tell whether it changed since it was last synced. */
export async function fingerprint(directory: string): Promise<string> {
  const lines: string[] = []
  const walk = async (relative: string): Promise<void> => {
    for (const entry of await readdir(join(directory, relative), { withFileTypes: true })) {
      const path = relative === '' ? entry.name : `${relative}/${entry.name}`
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile()) { const info = await stat(join(directory, path)); lines.push(`${path}\t${info.size}\t${Math.trunc(info.mtimeMs)}`) }
    }
  }
  await walk('')
  return createHash('sha256').update(lines.sort((left, right) => left.localeCompare(right)).join('\n')).digest('hex')
}

/** The files that two copies of one file left side by side (`name.conflict1` is this device's, `name.conflict2` the remote's). */
export async function conflictFiles(directory: string): Promise<string[]> {
  const found: string[] = []
  const walk = async (relative: string): Promise<void> => {
    for (const entry of await readdir(join(directory, relative), { withFileTypes: true })) {
      const path = relative === '' ? entry.name : `${relative}/${entry.name}`
      if (entry.isDirectory()) await walk(path)
      else if (/\.conflict[12]$/.test(entry.name)) found.push(path)
    }
  }
  await walk('')
  return found.sort((left, right) => left.localeCompare(right))
}
