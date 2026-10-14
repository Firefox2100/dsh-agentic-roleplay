import { createHash } from 'node:crypto'
import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { PACKS_FOLDER, type WorldPackState } from '../../shared/interface-pack.ts'
import { isPackId, packFile, readPack, type LoadedPack, type PackProblem } from './pack.ts'

/** The setting value that turns packs off. */
export const NO_PACK = 'none'

const packsIn = (base: string): string => join(base, PACKS_FOLDER)

/** The ids of the packs a folder (a world, a session or the root) carries, in order. */
export function packIds(base: string): string[] {
  const folder = packsIn(base)
  if (!existsSync(folder)) return []
  return readdirSync(folder, { withFileTypes: true }).filter(entry => entry.isDirectory() && isPackId(entry.name)).map(entry => entry.name).sort()
}

/** Checks every pack a world carries. @returns the ids of the packs, and the problems found, each with the file. */
function checkWorldPacks(worldDirectory: string): { ids: string[]; problems: { path: string; message: string }[] } {
  const source = packsIn(worldDirectory)
  const problems: { path: string; message: string }[] = []
  const ids: string[] = []
  if (!existsSync(source)) return { ids, problems }
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const path = join(source, entry.name)
    if (!entry.isDirectory() || !isPackId(entry.name)) { problems.push({ path, message: 'a pack is a folder named with letters, digits, "-" and "_"' }); continue }
    const checked = readPack(path, entry.name, file => file)
    for (const problem of checked.problems) problems.push({ path: problem.file === '' ? path : join(path, problem.file), message: problem.message })
    ids.push(entry.name)
  }
  return { ids, problems }
}

/**
 * Copies the packs a world carries into a session folder after checking each of them.
 * @returns the problems found, each with the file; nothing is copied when there are any.
 */
export function copyWorldPacks(worldDirectory: string, target: string): { path: string; message: string }[] {
  const { ids, problems } = checkWorldPacks(worldDirectory)
  if (problems.length > 0) return problems
  for (const id of ids) copyTree(join(packsIn(worldDirectory), id), join(packsIn(target), id))
  return []
}

/** A hash of what a pack folder holds: the names and the contents of its files, not their dates. */
export function packFingerprint(directory: string): string {
  const hash = createHash('sha256')
  const walk = (folder: string, prefix: string): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(folder, entry.name)
      if (lstatSync(path).isSymbolicLink()) continue
      const name = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) walk(path, name)
      else if (entry.isFile()) hash.update(`${name}\0`).update(readFileSync(path)).update('\0')
    }
  }
  walk(directory, '')
  return hash.digest('hex')
}

/** How each pack of the world compares with the story's copy. */
export function worldPackStates(worldDirectory: string, sessionFolder: string): { id: string; state: WorldPackState }[] {
  return packIds(worldDirectory).map((id) => {
    const copy = join(packsIn(sessionFolder), id)
    const state = !existsSync(copy) ? 'new' as const : packFingerprint(copy) === packFingerprint(join(packsIn(worldDirectory), id)) ? 'same' as const : 'different' as const
    return { id, state }
  })
}

/**
 * Brings the packs of a world into a story's folder: new ones are added and a different copy is replaced, the old one
 * moved to the story's `.trash`. Every pack of the world is checked first and nothing is changed when one has problems.
 */
export function syncWorldPacks(worldDirectory: string, sessionFolder: string, now: () => number = Date.now): { problems: { path: string; message: string }[]; updated: string[]; added: string[]; unchanged: string[] } {
  const { ids, problems } = checkWorldPacks(worldDirectory)
  const result = { problems, updated: [] as string[], added: [] as string[], unchanged: [] as string[] }
  if (problems.length > 0) return result
  for (const { id, state } of worldPackStates(worldDirectory, sessionFolder)) {
    if (!ids.includes(id) || state === 'same') { result.unchanged.push(id); continue }
    const copy = join(packsIn(sessionFolder), id)
    if (state === 'different') {
      const aside = join(sessionFolder, '.trash', PACKS_FOLDER, `${id}.${now()}`)
      mkdirSync(dirname(aside), { recursive: true })
      renameSync(copy, aside)
      result.updated.push(id)
    } else result.added.push(id)
    copyTree(join(packsIn(worldDirectory), id), copy)
  }
  return result
}

function copyTree(from: string, to: string): void {
  mkdirSync(to, { recursive: true })
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const source = join(from, entry.name)
    if (entry.isDirectory()) copyTree(source, join(to, entry.name))
    else if (entry.isFile()) { mkdirSync(dirname(join(to, entry.name)), { recursive: true }); copyFileSync(source, join(to, entry.name)) }
  }
}

/** A branch plays with the packs of the session it was cut from. */
export function inheritPacks(from: string, to: string): void {
  if (existsSync(packsIn(from))) cpSync(packsIn(from), packsIn(to), { recursive: true })
}

export interface ActivePack {
  /** The pack in use; none when there is none, when packs are off or when it has problems. */
  pack?: LoadedPack
  problems: PackProblem[]
  /** Where it was found. */
  from?: 'session' | 'root'
}

/**
 * The pack a session uses. `choice` is the setting: empty is the first pack the session carries,
 * `none` is no pack, an id is that pack of the session, else of the root. Packs of the root are used only when named.
 */
export function activePack(sessionFolder: string, rootFolder: string, choice: string, address: (id: string) => (path: string) => string): ActivePack {
  const wanted = choice.trim()
  if (wanted === NO_PACK) return { problems: [] }
  const id = wanted === '' ? packIds(sessionFolder)[0] : wanted
  if (id === undefined) return { problems: [] }
  const from = packIds(sessionFolder).includes(id) ? 'session' : packIds(rootFolder).includes(id) ? 'root' : undefined
  if (from === undefined) return { problems: [{ file: '', message: `there is no pack "${id}" in this story or in the root` }] }
  const loaded = readPack(join(packsIn(from === 'session' ? sessionFolder : rootFolder), id), id, address(id))
  return loaded.pack === undefined ? { problems: loaded.problems, from } : { pack: loaded.pack, problems: [], from }
}

/** The file of a pack the browser asked for, or nothing. */
export { packFile }

/** Whether any pack with a tab surface stands in the folders given; only the manifests are looked at. */
export function anyTab(bases: readonly string[]): boolean {
  return bases.some(base => packIds(base).some((id) => {
    try {
      const manifest = JSON.parse(readFileSync(join(packsIn(base), id, 'pack.json'), 'utf8')) as { surfaces?: { tab?: unknown } } | null
      return typeof manifest?.surfaces === 'object' && manifest.surfaces !== null && manifest.surfaces.tab !== undefined
    } catch {
      return false
    }
  }))
}
