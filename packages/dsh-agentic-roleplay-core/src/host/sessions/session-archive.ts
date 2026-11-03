import { randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { isSessionId, openSessionStore, SESSION_DATABASE_FILE, sessionDatabase, sessionFolder, type RoleplayState } from '@dsh-agentic-roleplay/state'
import { readZip } from '../catalogue/zip.ts'
import { writeZip } from '../catalogue/zip-write.ts'
import { SessionNotFoundError } from './errors.ts'

export const ARCHIVE_FORMAT = 'dsh-agentic-roleplay/session-archive'
export const ARCHIVE_VERSION = 1
const MANIFEST = 'manifest.json'
const SESSION_PREFIX = 'session/'
const WORLD_PREFIX = 'world/'
const TEMPORARY_SNAPSHOT = 'archive-export'

/** What an archive does not carry: the database is taken fresh, and the rest is working state of this device or of an earlier archive. */
const LEFT_OUT = new Set([SESSION_DATABASE_FILE, 'status.json', '.trash', '.sync'])
const LEFT_OUT_SUFFIX = ['.writing', '.restoring', '-journal', '-wal', '-shm']

export class InvalidArchiveError extends Error {}

export interface ArchiveManifest {
  format: typeof ARCHIVE_FORMAT
  version: typeof ARCHIVE_VERSION
  exportedAt: string
  session: { id: string; name: string; turns: number }
  world: { id: string; name: string; included: boolean }
}

export interface ArchiveDeps {
  state: Pick<RoleplayState, 'snapshot' | 'removeSnapshot' | 'openSession'>
  sessionsDir: () => string
  worldsDir: () => string
  /** Finds the folder of a world the person already has, so an archive does not add it twice. */
  worldDirectory: (id: string) => Promise<string | undefined>
  maxBytes: () => number
  now?: () => Date
}

/** Every file of a folder as `prefix` + its path, except those left out and links. */
function collect(directory: string, prefix: string, files: Map<string, Buffer>, skip: (path: string) => boolean = () => false): void {
  const walk = (at: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name)
      const inside = relative(directory, path).split('\\').join('/')
      if (skip(inside) || entry.isSymbolicLink()) continue
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile() && lstatSync(path).isFile()) files.set(`${prefix}${inside}`, readFileSync(path))
    }
  }
  walk(directory)
}

/**
 * A session as one ZIP: the story's database as it is now, every other file of its folder (the timeline with every turn that was played, the settings,
 * the pictures, the kept states and the prompts it was given) and a copy of the world it was started from, so it can be put back on another machine.
 * @throws {SessionNotFoundError} when the id names no session. @throws {RangeError} when the archive is too large for a ZIP.
 */
export function exportSession(deps: ArchiveDeps, id: string): { file: string; bytes: Buffer } {
  const directory = deps.sessionsDir()
  if (!isSessionId(id) || !existsSync(sessionDatabase(directory, id))) throw new SessionNotFoundError(`no session "${id}"`)
  const folder = sessionFolder(directory, id)
  const metadata = deps.state.openSession(directory, id).metadata.get()
  const files = new Map<string, Buffer>()
  deps.state.snapshot(directory, id, TEMPORARY_SNAPSHOT)
  const copy = join(folder, 'snapshots', `${TEMPORARY_SNAPSHOT}.sqlite`)
  try { files.set(`${SESSION_PREFIX}${SESSION_DATABASE_FILE}`, readFileSync(copy)) } finally { deps.state.removeSnapshot(directory, id, TEMPORARY_SNAPSHOT) }
  collect(folder, SESSION_PREFIX, files, path => LEFT_OUT.has(path.split('/')[0]!) || LEFT_OUT_SUFFIX.some(suffix => path.endsWith(suffix)))
  const source = metadata.world.source
  const worldFolder = source !== undefined && source.startsWith('worlds/') ? join(deps.worldsDir(), source.slice('worlds/'.length)) : undefined
  const worldHere = worldFolder !== undefined && existsSync(join(worldFolder, 'world.json'))
  if (worldHere) collect(worldFolder, WORLD_PREFIX, files, path => path.split('/')[0] === '.trash')
  const manifest: ArchiveManifest = {
    format: ARCHIVE_FORMAT, version: ARCHIVE_VERSION, exportedAt: (deps.now?.() ?? new Date()).toISOString(),
    session: { id, name: metadata.name, turns: metadata.turns }, world: { id: metadata.world.id, name: metadata.world.name, included: worldHere },
  }
  files.set(MANIFEST, Buffer.from(JSON.stringify(manifest, null, 2)))
  return { file: `${folderName(metadata.name) || 'story'}.dsh-story.zip`, bytes: writeZip(files) }
}

function manifestOf(files: Map<string, Buffer>): ArchiveManifest {
  const raw = files.get(MANIFEST)
  if (raw === undefined) throw new InvalidArchiveError('this is not a story archive: it has no manifest.json')
  let value: Partial<ArchiveManifest>
  try { value = JSON.parse(raw.toString('utf8')) as Partial<ArchiveManifest> } catch { throw new InvalidArchiveError('the manifest of this archive is not valid JSON') }
  if (value.format !== ARCHIVE_FORMAT) throw new InvalidArchiveError('this is not a story archive of this program')
  if (value.version !== ARCHIVE_VERSION) throw new InvalidArchiveError(`this archive is version ${String(value.version)}; this program reads version ${ARCHIVE_VERSION}`)
  if (typeof value.session?.name !== 'string' || value.session.name.trim() === '' || typeof value.world?.id !== 'string' || value.world.id.trim() === '' || typeof value.world.name !== 'string' || typeof value.world.included !== 'boolean') throw new InvalidArchiveError('the manifest of this archive is incomplete')
  return value as ArchiveManifest
}

function write(root: string, files: Map<string, Buffer>, prefix: string): void {
  for (const [name, content] of files) {
    if (!name.startsWith(prefix)) continue
    const target = join(root, name.slice(prefix.length))
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content)
  }
}

/**
 * Puts an archived story back as a new session with an identity of its own (the original may still exist), named like it with " (restored)". The world it
 * carries is added to the worlds when the person has none with that id. The chat is made when the session is first opened.
 * @throws {InvalidArchiveError} when the file is not an archive this program can read. Nothing is left behind when it fails.
 */
export async function importSession(deps: ArchiveDeps, bytes: Buffer): Promise<{ id: string; name: string; worldAdded: boolean }> {
  let files: Map<string, Buffer>
  try { files = readZip(bytes, { maxBytes: deps.maxBytes() }) } catch (error) { throw new InvalidArchiveError(error instanceof Error ? error.message : String(error)) }
  const manifest = manifestOf(files)
  if (!files.has(`${SESSION_PREFIX}${SESSION_DATABASE_FILE}`)) throw new InvalidArchiveError('the archive holds no story database')
  const id = randomUUID()
  const directory = deps.sessionsDir()
  const folder = sessionFolder(directory, id)
  const name = `${manifest.session.name} (restored)`.slice(0, 200)
  const added: string[] = []
  try {
    mkdirSync(folder, { recursive: true })
    write(folder, files, SESSION_PREFIX)
    const existingWorld = await deps.worldDirectory(manifest.world.id)
    let worldDirectory = existingWorld
    if (manifest.world.included && existingWorld === undefined && [...files.keys()].some(key => key.startsWith(WORLD_PREFIX))) {
      worldDirectory = freeFolder(deps.worldsDir(), folderName(manifest.world.name) || 'world')
      added.push(worldDirectory)
      write(worldDirectory, files, WORLD_PREFIX)
    }
    const store = openSessionStore(sessionDatabase(directory, id))
    try {
      const was = store.metadata.get()
      store.metadata.rebrand(id, name, was.createdAt)
      store.metadata.setWorld({ ...was.world, ...(worldDirectory === undefined ? {} : { source: `worlds/${basename(worldDirectory)}` }) })
    } finally { store.close() }
  } catch (error) {
    rmSync(folder, { recursive: true, force: true })
    for (const target of added) rmSync(target, { recursive: true, force: true })
    throw error
  }
  return { id, name, worldAdded: added.length > 0 }
}

/** A name that is safe as a file or folder name on any system: letters, digits and marks of any script, with single hyphens between the rest. */
export const folderName = (name: string): string => name.normalize('NFKC').replace(/[^\p{L}\p{N}\p{M}]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 60)

/** A folder name under `parent` that is free: the name itself, or with -2, -3... */
function freeFolder(parent: string, name: string): string {
  for (let attempt = 1; ; attempt += 1) {
    const candidate = join(parent, attempt === 1 ? name : `${name}-${attempt}`)
    if (!existsSync(candidate)) return candidate
  }
}
