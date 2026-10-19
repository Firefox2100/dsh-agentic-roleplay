import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve, sep } from 'node:path'
import type { InstallMode, InstallResult } from '../../shared/catalogue.ts'
import { formatIssue } from '../validation.ts'
import type { WorldCatalog } from '../worlds/catalog.ts'
import { indentOf } from '../worlds/world-id.ts'
import { parseWorldFile, WORLD_FILE_NAME } from '../worlds/world-file.ts'
import { CatalogueError } from './errors.ts'
import { describeChanges, hashWorld, isUnchanged, localChanges, writeOrigin, type Provenance } from './origin.ts'
import { readZip } from './zip.ts'

const FOLDER_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/
const MAX_FOLDER_COPIES = 99

/** The one top-level folder of a world archive and the files in it, or why the archive is not a world. */
function worldFolder(files: Map<string, Buffer>): string {
  const marks = [...files.keys()].filter(path => path.split('/').pop() === WORLD_FILE_NAME)
  if (marks.length !== 1 || marks[0]!.split('/').length !== 2) throw new CatalogueError(`the archive must hold one top-level world folder with ${WORLD_FILE_NAME}`, 'invalid')
  const folder = marks[0]!.split('/')[0]!
  if (!FOLDER_NAME.test(folder)) throw new CatalogueError(`the world folder "${folder}" has an unsafe or unsupported name`, 'invalid')
  const stray = [...files.keys()].find(path => path.split('/')[0] !== folder)
  if (stray !== undefined) throw new CatalogueError(`every file must be inside the "${folder}" folder: ${stray}`, 'invalid')
  return folder
}

function freeFolder(directory: string, wanted: string): string {
  for (let copy = 1; copy <= MAX_FOLDER_COPIES + 1; copy += 1) {
    const candidate = copy === 1 ? wanted : `${wanted}-${copy}`
    if (!existsSync(join(directory, candidate))) return candidate
  }
  throw new CatalogueError(`there are already ${MAX_FOLDER_COPIES} world folders named like "${wanted}"`, 'conflict')
}

export interface InstallOptions {
  mode: InstallMode
  /** Replace a world even though its files differ from the release they came from. */
  overwriteChanges: boolean
  /** The catalogue release the archive is; a world installed with it can be offered later releases. */
  provenance?: Provenance
}

/** The world file of a second copy: its own identity and a name that tells it from the first. */
function asCopy(text: string, id: string, name: string): string {
  const document = JSON.parse(text.replace(/^\uFEFF/, '')) as Record<string, unknown>
  const { id: _previous, name: _name, ...rest } = document
  return JSON.stringify({ id, name, ...rest }, null, indentOf(text)) + (text.endsWith('\n') ? '\n' : '')
}

const stamp = (): string => new Date().toISOString().replace(/[:.]/g, '-')

/**
 * Unpacks a world archive into the person's worlds, after the same checks the worlds list makes of a world: it is written beside the
 * worlds first and only moved in when whole, and removed again if the catalogue then refuses it.
 *
 * `new` never replaces a world the person has. `update` replaces the world with the same identity, keeping its folder, after moving the
 * old files to `<root>/.trash/worlds/` so nothing is lost, and only when the files still match the release they came from (or the person
 * said to overwrite). `copy` gives the release a new identity and installs it beside the world the person has.
 * @throws {CatalogueError} `invalid` when the archive is not a valid world, `conflict` when the person has the world (`new`) or changed it (`update`).
 */
export async function installWorld(catalog: WorldCatalog, archive: Buffer, maxBytes: number, options: InstallOptions): Promise<InstallResult> {
  const files = readZip(archive, { maxBytes })
  const folder = worldFolder(files)
  const worldText = files.get(`${folder}/${WORLD_FILE_NAME}`)!.toString('utf8')
  const parsed = parseWorldFile(worldText.replace(/^\uFEFF/, ''))
  if (!parsed.ok) throw new CatalogueError(`${WORLD_FILE_NAME} is not valid: ${parsed.issues.map(formatIssue).join('; ')}`, 'invalid')
  const world = parsed.value
  const known = await catalog.list({ refresh: true })
  const existing = world.id === undefined ? undefined : known.worlds.find(candidate => candidate.id === world.id)
  const record = existing === undefined ? undefined : await catalog.find(existing.id)
  if (existing !== undefined && options.mode === 'new') throw new CatalogueError(`you already have "${existing.name}"`, 'conflict', { reason: 'exists' })
  if (record !== undefined && options.mode === 'update' && !options.overwriteChanges) {
    const changes = await localChanges(record.directory)
    if (changes === 'unverified') throw new CatalogueError(`"${existing!.name}" has no record of the release it came from, so there is no telling whether you changed it`, 'conflict', { reason: 'unverified' })
    if (!isUnchanged(changes)) throw new CatalogueError(`you changed "${existing!.name}" since you installed it`, 'conflict', { reason: 'modified', changes: describeChanges(changes) })
  }
  const replacing = options.mode === 'update' ? record : undefined
  const copyId = options.mode === 'copy' && existing !== undefined ? randomUUID() : undefined

  const root = dirname(catalog.directory)
  const staging = join(root, '.install', randomUUID())
  const stagedFolder = join(staging, folder)
  let placed: string | undefined
  let backup: string | undefined
  try {
    for (const [path, content] of files) {
      const target = resolve(staging, path)
      if (!target.startsWith(`${resolve(stagedFolder)}${sep}`)) throw new CatalogueError(`the archive path "${path}" leaves the world folder`, 'invalid')
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, path === `${folder}/${WORLD_FILE_NAME}` && copyId !== undefined ? asCopy(worldText, copyId, `${world.name} (copy)`) : content)
    }
    await mkdir(catalog.directory, { recursive: true })
    if (replacing !== undefined) {
      placed = basename(replacing.directory)
      backup = join('.trash', 'worlds', `${placed}-${stamp()}`)
      await mkdir(join(root, dirname(backup)), { recursive: true })
      await rename(replacing.directory, join(root, backup))
    } else {
      placed = freeFolder(catalog.directory, folder)
    }
    await rename(stagedFolder, join(catalog.directory, placed))
    const payload = await catalog.list({ refresh: true })
    const wanted = copyId ?? world.id
    const added = wanted === undefined ? payload.worlds.find(candidate => candidate.name === world.name) : payload.worlds.find(candidate => candidate.id === wanted)
    if (added === undefined) {
      await rm(join(catalog.directory, placed), { recursive: true, force: true })
      if (replacing !== undefined && backup !== undefined) await rename(join(root, backup), replacing.directory)
      await catalog.list({ refresh: true })
      const reasons = payload.problems.filter(problem => problem.path.includes(placed!)).map(problem => problem.message)
      throw new CatalogueError(`the world was refused: ${reasons.length === 0 ? 'it was not found when the worlds were read' : reasons.join('; ')}`, 'invalid')
    }
    const tracked = options.provenance !== undefined && copyId === undefined
    if (tracked) {
      const directory = join(catalog.directory, placed)
      await writeOrigin(directory, { kind: 'release', ...options.provenance!, files: await hashWorld(directory) })
    }
    const packs = [...files.keys()].map(path => path.split('/')).filter(parts => parts.length === 4 && parts[1] === 'ui' && parts[3] === 'pack.json').map(parts => parts[2]!)
    return { world: added, packs, tracked, ...(backup === undefined ? {} : { backup }) }
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}
