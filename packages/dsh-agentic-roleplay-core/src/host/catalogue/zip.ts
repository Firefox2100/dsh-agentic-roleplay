import { inflateRawSync } from 'node:zlib'
import { CatalogueError } from './errors.ts'

const END_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50
const MAX_FILES = 5000
const SYMBOLIC_LINK = 0o120000
const TYPE_MASK = 0o170000

export interface ZipLimits {
  /** The most the files may be together once unpacked. */
  maxBytes: number
}

const invalid = (message: string): CatalogueError => new CatalogueError(message, 'invalid')

/** An archive path that stays inside the folder it is unpacked to, or the reason it does not. */
export function archivePathProblem(name: string): string | undefined {
  if (name.includes('\\') || name.includes('\0')) return 'has a backslash or a NUL character'
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) return 'is absolute'
  const parts = name.split('/')
  if (parts.some(part => part === '..')) return 'climbs out of the folder'
  if (parts.some((part, index) => part === '.' || (part === '' && index !== parts.length - 1))) return 'is ambiguous'
  return undefined
}

/**
 * Reads the files of a ZIP archive, refusing anything that could write outside the target or exhaust the machine: unsafe or repeated paths
 * (also by case), links, encryption, ZIP64, methods other than stored and deflate, too many files, and a total size past the limit
 * (checked from the sizes the archive declares and again from what inflating really produced).
 * @throws {CatalogueError} (`invalid`) when the archive is not acceptable.
 */
export function readZip(archive: Buffer, limits: ZipLimits): Map<string, Buffer> {
  let end = -1
  for (let at = archive.length - 22; at >= Math.max(0, archive.length - 22 - 65535); at -= 1) {
    if (archive.readUInt32LE(at) === END_SIGNATURE) { end = at; break }
  }
  if (end < 0) throw invalid('the file is not a ZIP archive')
  const count = archive.readUInt16LE(end + 10)
  const directorySize = archive.readUInt32LE(end + 12)
  let at = archive.readUInt32LE(end + 16)
  if (count === 0xffff || directorySize === 0xffffffff || at === 0xffffffff) throw invalid('ZIP64 archives are not supported')
  if (count > MAX_FILES) throw invalid(`the archive holds more than ${MAX_FILES} files`)
  const files = new Map<string, Buffer>()
  const folded = new Set<string>()
  let declared = 0
  let produced = 0
  for (let index = 0; index < count; index += 1) {
    if (at + 46 > archive.length || archive.readUInt32LE(at) !== CENTRAL_SIGNATURE) throw invalid('the archive directory is damaged')
    const flags = archive.readUInt16LE(at + 8)
    const method = archive.readUInt16LE(at + 10)
    const compressed = archive.readUInt32LE(at + 20)
    const size = archive.readUInt32LE(at + 24)
    const nameLength = archive.readUInt16LE(at + 28)
    const extraLength = archive.readUInt16LE(at + 30)
    const commentLength = archive.readUInt16LE(at + 32)
    const attributes = archive.readUInt32LE(at + 38)
    const local = archive.readUInt32LE(at + 42)
    if (at + 46 + nameLength > archive.length) throw invalid('the archive directory is damaged')
    const name = archive.toString('utf8', at + 46, at + 46 + nameLength)
    at += 46 + nameLength + extraLength + commentLength
    const problem = archivePathProblem(name)
    if (problem !== undefined) throw invalid(`the archive path "${name}" ${problem}`)
    if (name.endsWith('/')) continue
    if (((attributes >>> 16) & TYPE_MASK) === SYMBOLIC_LINK) throw invalid(`the archive holds a link: ${name}`)
    if ((flags & 1) !== 0) throw invalid('encrypted archives are not supported')
    if (method !== 0 && method !== 8) throw invalid(`the archive entry ${name} uses an unsupported compression method`)
    if (compressed === 0xffffffff || size === 0xffffffff) throw invalid('ZIP64 archives are not supported')
    const key = name.toLowerCase()
    if (files.has(name) || folded.has(key)) throw invalid(`the archive repeats a path (or differs only by case): ${name}`)
    declared += size
    if (declared > limits.maxBytes) throw invalid(`the archive unpacks to more than ${limits.maxBytes} bytes`)
    if (local + 30 > archive.length || archive.readUInt32LE(local) !== LOCAL_SIGNATURE) throw invalid(`the archive entry ${name} is damaged`)
    const start = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28)
    if (start + compressed > archive.length) throw invalid(`the archive entry ${name} is cut short`)
    const raw = archive.subarray(start, start + compressed)
    let content: Buffer
    try { content = method === 0 ? Buffer.from(raw) : inflateRawSync(raw, { maxOutputLength: Math.max(size, 1) }) } catch { throw invalid(`the archive entry ${name} cannot be unpacked`) }
    if (content.length !== size) throw invalid(`the archive entry ${name} does not match its declared size`)
    produced += content.length
    if (produced > limits.maxBytes) throw invalid(`the archive unpacks to more than ${limits.maxBytes} bytes`)
    files.set(name, content)
    folded.add(key)
  }
  return files
}
