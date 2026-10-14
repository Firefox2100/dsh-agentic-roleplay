import { createHash } from 'node:crypto'
import { lstatSync, readdirSync, readFileSync } from 'node:fs'
import { extname, join, posix, sep } from 'node:path'
import { PACK_ACTIONS, PACK_API, PACK_LIMITS, PACK_MEDIA_TYPES, STRIP_HEIGHTS, SURFACE_NAMES, isStrip, type InterfaceDescription, type PackAction, type PackManifest, type PackSurface, type PackProblem, type PackToken, type SurfaceName } from '../../shared/interface-pack.ts'
import { Reader, type Issue } from '../validation.ts'
import { checkSkin } from './skin.ts'

export type { PackProblem }

export interface PackFile {
  size: number
  mtimeMs: number
  mediaType: string
}

export interface LoadedPack {
  id: string
  directory: string
  manifest: PackManifest
  files: ReadonlyMap<string, PackFile>
  revision: string
  /** The skin as it goes into the page. */
  skin: string
}

const ID = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,59}$/u
const SEGMENT = /^[\p{L}\p{N}_.-]+$/u
const TOKEN_NAME = /^--dsw-alias-[a-z0-9-]+$/
const COLOUR_REFUSED = /url\(|var\(|expression|javascript:|[;{}]|@import/i

export const isPackId = (id: string): boolean => ID.test(id)

/** Every file of a pack folder, relative with `/`, with what is wrong with the folder itself. */
function inventory(directory: string, problems: PackProblem[]): Map<string, PackFile> {
  const files = new Map<string, PackFile>()
  let bytes = 0
  const walk = (folder: string, prefix: string, depth: number): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      const path = join(folder, entry.name)
      if (!SEGMENT.test(entry.name)) { problems.push({ file: relative, message: 'the name may hold only letters, digits, "-", "_" and "."' }); continue }
      if (entry.name === '.' || entry.name === '..' || entry.name.startsWith('.')) { problems.push({ file: relative, message: 'names may not start with a dot' }); continue }
      const status = lstatSync(path)
      if (status.isSymbolicLink()) { problems.push({ file: relative, message: 'symbolic links are not allowed' }); continue }
      if (status.isDirectory()) {
        if (depth >= PACK_LIMITS.depth) problems.push({ file: relative, message: `folders go at most ${PACK_LIMITS.depth} deep` })
        else walk(path, relative, depth + 1)
        continue
      }
      if (!status.isFile()) { problems.push({ file: relative, message: 'only files and folders are allowed' }); continue }
      const mediaType = PACK_MEDIA_TYPES[extname(entry.name).slice(1).toLowerCase()]
      if (mediaType === undefined) { problems.push({ file: relative, message: `this kind of file is not allowed (allowed: ${Object.keys(PACK_MEDIA_TYPES).join(', ')})` }); continue }
      if (status.size > PACK_LIMITS.fileBytes) { problems.push({ file: relative, message: `the file is larger than ${PACK_LIMITS.fileBytes / 1024} KB` }); continue }
      bytes += status.size
      files.set(relative, { size: status.size, mtimeMs: Math.floor(status.mtimeMs), mediaType })
    }
  }
  walk(directory, '', 1)
  if (files.size > PACK_LIMITS.files) problems.push({ file: '', message: `a pack holds at most ${PACK_LIMITS.files} files` })
  if (bytes > PACK_LIMITS.bytes) problems.push({ file: '', message: `a pack holds at most ${PACK_LIMITS.bytes / 1024 / 1024} MB` })
  return files
}

/** A path as a pack names it: relative, with `/`, inside the folder. */
export function packPath(path: string): string | undefined {
  if (path === '' || path.includes('\0') || path.includes('\\') || path.startsWith('/')) return undefined
  const normal = posix.normalize(path)
  if (normal === '.' || normal.startsWith('../') || normal === '..') return undefined
  return normal
}

const issuesToProblems = (issues: Issue[]): PackProblem[] => issues.map(issue => ({ file: 'pack.json', message: issue.path === '' ? issue.message : `${issue.path}: ${issue.message}` }))

/** The tokens of `theme`, each with both palettes. */
function themeOf(value: unknown, problems: PackProblem[]): Record<string, PackToken> {
  const theme: Record<string, PackToken> = {}
  if (value === undefined || value === null) return theme
  if (typeof value !== 'object' || Array.isArray(value)) { problems.push({ file: 'pack.json', message: 'theme: must be an object of tokens' }); return theme }
  for (const [name, token] of Object.entries(value as Record<string, unknown>)) {
    const place = `theme.${name}`
    if (!TOKEN_NAME.test(name)) { problems.push({ file: 'pack.json', message: `${place}: only tokens named --dsw-alias-... can be set` }); continue }
    const pair = token as { light?: unknown; dark?: unknown } | null
    if (typeof pair !== 'object' || pair === null || typeof pair.light !== 'string' || typeof pair.dark !== 'string') { problems.push({ file: 'pack.json', message: `${place}: must be { "light": "...", "dark": "..." }` }); continue }
    if ([pair.light, pair.dark].some(colour => colour.trim() === '' || colour.length > 120 || COLOUR_REFUSED.test(colour))) { problems.push({ file: 'pack.json', message: `${place}: values must be plain CSS colours` }); continue }
    theme[name] = { light: pair.light.trim(), dark: pair.dark.trim() }
  }
  return theme
}

function surfacesOf(reader: Reader | undefined, written: unknown, files: ReadonlyMap<string, PackFile>, problems: PackProblem[]): Partial<Record<SurfaceName, PackSurface>> {
  const surfaces: Partial<Record<SurfaceName, PackSurface>> = {}
  if (reader === undefined) return surfaces
  for (const key of Object.keys(written as Record<string, unknown>)) {
    if (!SURFACE_NAMES.some(name => name === key)) problems.push({ file: 'pack.json', message: `surfaces.${key}: there is no such place (${SURFACE_NAMES.join(', ')})` })
  }
  for (const name of SURFACE_NAMES) {
    const entry = reader.object(name)
    if (entry === undefined) continue
    const file = entry.string('file', { required: true })
    if (file === undefined) continue
    const path = packPath(file)
    if (path === undefined || !path.endsWith('.html')) { problems.push({ file: 'pack.json', message: `surfaces.${name}.file: must be a .html file inside the pack` }); continue }
    if (!files.has(path)) { problems.push({ file: 'pack.json', message: `surfaces.${name}.file: the pack has no file "${path}"` }); continue }
    const range = isStrip(name) ? STRIP_HEIGHTS[name] : undefined
    const height = range === undefined ? undefined : entry.number('height', { min: range.min, max: range.max }) ?? range.fallback
    surfaces[name] = { file: path, title: entry.text('title'), ...(height === undefined ? {} : { height }) }
  }
  return surfaces
}

/** The address a pack file is served at, which a skin's urls are rewritten to. */
export type FileAddress = (path: string) => string

/** What changes when the pack does. */
function revisionOf(files: ReadonlyMap<string, PackFile>): string {
  const hash = createHash('sha256')
  for (const [path, file] of [...files].sort(([a], [b]) => a.localeCompare(b))) hash.update(`${path}\0${file.size}\0${file.mtimeMs}\n`)
  return hash.digest('hex').slice(0, 16)
}

/**
 * Reads a pack folder and checks all of it: the manifest, the theme, the skin, the surfaces and every file.
 * @returns the pack when nothing is wrong, and every problem found otherwise.
 */
export function readPack(directory: string, id: string, address: FileAddress): { pack?: LoadedPack; problems: PackProblem[] } {
  const problems: PackProblem[] = []
  if (!ID.test(id)) return { problems: [{ file: '', message: `"${id}" is not a usable pack name (letters, digits, "-" and "_")` }] }
  let files: Map<string, PackFile>
  try {
    files = inventory(directory, problems)
  } catch (error) {
    return { problems: [{ file: '', message: `the folder cannot be read: ${error instanceof Error ? error.message : String(error)}` }] }
  }
  const manifestFile = files.get('pack.json')
  if (manifestFile === undefined) return { problems: [...problems, { file: 'pack.json', message: 'the pack has no pack.json' }] }
  const issues: Issue[] = []
  const reader = Reader.fromJson(readFileSync(join(directory, 'pack.json'), 'utf8'), issues)
  if (reader === undefined) return { problems: [...problems, ...issuesToProblems(issues)] }
  const api = reader.number('api', { min: 1 }) ?? PACK_API
  if (api !== PACK_API) problems.push({ file: 'pack.json', message: `api: this version knows only api ${PACK_API}, the pack asks for ${api}` })
  const name = reader.string('name') ?? id
  const actions: PackAction[] = []
  for (const action of reader.strings('actions')) {
    const known = PACK_ACTIONS.find(candidate => candidate === action)
    if (known === undefined) problems.push({ file: 'pack.json', message: `actions: "${action}" is not an action (${PACK_ACTIONS.join(', ')})` })
    else actions.push(known)
  }
  const theme = themeOf(reader.raw('theme'), problems)
  const surfaces = surfacesOf(reader.object('surfaces'), reader.raw('surfaces'), files, problems)
  const skinName = reader.string('skin')
  let skin = ''
  let skinPath: string | undefined
  if (skinName !== undefined) {
    skinPath = packPath(skinName)
    if (skinPath === undefined || !skinPath.endsWith('.css')) problems.push({ file: 'pack.json', message: 'skin: must be a .css file inside the pack' })
    else if (!files.has(skinPath)) problems.push({ file: 'pack.json', message: `skin: the pack has no file "${skinPath}"` })
    else {
      const checked = checkSkin(readFileSync(join(directory, ...skinPath.split('/')), 'utf8'), (path) => {
        const resolved = packPath(posix.join(posix.dirname(skinPath as string), path))
        return resolved !== undefined && files.has(resolved) ? address(resolved) : undefined
      })
      for (const problem of checked.problems) problems.push({ file: skinPath, message: `line ${problem.line}: ${problem.message}` })
      skin = checked.css
    }
  }
  problems.push(...issuesToProblems(issues))
  if (problems.length > 0) return { problems }
  const manifest: PackManifest = { id, name, version: reader.text('version'), description: reader.text('description'), api, theme, ...(skinPath === undefined ? {} : { skin: skinPath }), actions, surfaces }
  return { pack: { id, directory, manifest, files, revision: revisionOf(files), skin }, problems }
}

/** What the client is told of a pack. */
export function describePack(pack: LoadedPack, frame: string): InterfaceDescription {
  const { manifest } = pack
  return { id: pack.id, name: manifest.name, version: manifest.version, description: manifest.description, revision: pack.revision, frame, theme: manifest.theme, skin: pack.skin, actions: manifest.actions, surfaces: manifest.surfaces }
}

/** A file of a pack by the path asked for, when the pack has it; the path cannot lead out of the folder. */
export function packFile(pack: LoadedPack, requested: string): { file: string; size: number; mediaType: string } | undefined {
  const path = packPath(requested)
  const entry = path === undefined ? undefined : pack.files.get(path)
  if (path === undefined || entry === undefined) return undefined
  return { file: join(pack.directory, ...path.split('/').join(sep).split(sep)), size: entry.size, mediaType: entry.mediaType }
}
