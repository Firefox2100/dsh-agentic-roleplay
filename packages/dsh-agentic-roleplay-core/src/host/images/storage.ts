import { copyFile, link, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { VisualSubjectKind } from 'dsh-roleplay-model'
import { readPngMetadata, withPngMetadata } from './png-metadata.ts'

export interface EntityImageAddress {
  kind: VisualSubjectKind
  /** The id in a world file, or the numeric id inside a session. */
  localId: string | number
  globalId?: string
}

export interface VisualImageSubject extends EntityImageAddress {
  name: string
  identityVersion?: number
}

export interface VisualImageMetadata {
  schema: 'dsh-roleplay-image/v1'
  purpose: 'reference' | 'transient'
  createdAt: string
  prompt: string
  revisedPrompt?: string
  provider: string
  model: string
  subjects: VisualImageSubject[]
  source?: { turn: number; timelineNode: string; segment?: number }
}

const PLURAL: Record<VisualSubjectKind, string> = { character: 'characters', location: 'locations', item: 'items' }
/** Letters and digits of any script: an id written in the world's own language is as good a directory name as an ASCII one. */
const SAFE_SEGMENT = /^[\p{L}\p{N}][\p{L}\p{N}\p{M}._-]{0,199}$/u

function segment(value: string | number, name: string): string {
  const text = String(value)
  if (!SAFE_SEGMENT.test(text) || text === '.' || text === '..') throw new Error(`${name} is not safe for an image path`)
  return text
}

/** Stable directory of an entity's images. Global ids have their own namespace; otherwise the entity kind and local id identify it. */
export function entityImageDirectory(root: string, address: EntityImageAddress): string {
  return address.globalId === undefined
    ? join(root, 'images', PLURAL[address.kind], segment(address.localId, 'local entity id'))
    : join(root, 'images', 'global', segment(address.globalId, 'global entity id'))
}

export function referenceImagePath(root: string, address: EntityImageAddress): string {
  return join(entityImageDirectory(root, address), 'reference.png')
}

export function sceneImagePath(root: string, timelineNode: string, serial: number): string {
  if (!Number.isInteger(serial) || serial < 1 || serial > 999) throw new Error('scene image serial must be a whole number from 1 to 999')
  return join(root, 'images', 'scenes', `turn-${segment(timelineNode, 'timeline node id')}-${String(serial).padStart(2, '0')}.png`)
}

/** First unused serial of a timeline node. The exclusive scene write remains the authority if callers race. */
export async function nextSceneSerial(root: string, timelineNode: string): Promise<number> {
  const node = segment(timelineNode, 'timeline node id')
  const directory = join(root, 'images', 'scenes')
  let files: string[]
  try { files = await readdir(directory) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 1
    throw error
  }
  const pattern = new RegExp(`^turn-${node.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d{2,3})\\.png$`)
  const used = new Set(files.flatMap(file => { const match = pattern.exec(file); return match === null ? [] : [Number(match[1])] }))
  for (let serial = 1; serial <= 999; serial += 1) if (!used.has(serial)) return serial
  throw new Error(`timeline node ${timelineNode} already has 999 scene images`)
}

/** Writes one self-describing PNG atomically. Reference images deliberately replace the stable reference.png. */
export async function writeImage(path: string, png: Uint8Array, metadata: VisualImageMetadata, options: { replace?: boolean } = {}): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${Date.now()}.writing`
  await writeFile(temporary, withPngMetadata(png, metadata))
  if (options.replace === true) await rename(temporary, path)
  else {
    try { await link(temporary, path) } finally { await unlink(temporary).catch(() => undefined) }
  }
}

export async function readImageMetadata(path: string): Promise<VisualImageMetadata | undefined> {
  return readPngMetadata(await readFile(path)) as VisualImageMetadata | undefined
}

/** Gives a branch the canonical references and inherited scene files without making either branch depend on the other. */
export async function inheritImages(fromRoot: string, toRoot: string, nodes: readonly string[]): Promise<void> {
  const source = join(fromRoot, 'images')
  const target = join(toRoot, 'images')
  const allowedScenes = new Set(nodes)
  async function walk(from: string, to: string, sceneFiles = false): Promise<void> {
    let entries
    try { entries = await readdir(from, { withFileTypes: true }) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    await mkdir(to, { recursive: true })
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const childFrom = join(from, entry.name)
      const childTo = join(to, entry.name)
      if (entry.isDirectory()) await walk(childFrom, childTo, sceneFiles)
      else if (entry.isFile() && (!sceneFiles || [...allowedScenes].some(node => entry.name.startsWith(`turn-${node}-`)))) await linkOrCopy(childFrom, childTo)
    }
  }
  for (const name of ['global', 'characters', 'locations', 'items']) await walk(join(source, name), join(target, name))
  await walk(join(source, 'scenes'), join(target, 'scenes'), true)
}

async function linkOrCopy(from: string, to: string): Promise<void> {
  try { await link(from, to) } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'EXDEV' && code !== 'EPERM') throw error
    await copyFile(from, to)
  }
}
