import { createHash, randomBytes } from 'node:crypto'
import { copyFile, mkdir, readFile, readdir, rename, rm, stat } from 'node:fs/promises'
import { dirname, join, normalize, sep } from 'node:path'
import { atomicWriteJson } from '../atomic-write.ts'
import type { CheckpointDiff, CheckpointInfo, CheckpointReason } from '../../shared/checkpoints.ts'

export type { CheckpointDiff, CheckpointInfo, CheckpointReason }

export const CHECKPOINTS_FOLDER = '.checkpoints'
const FILES = 'files'
const INFO = 'checkpoint.json'
const RESTORED = 'restored.json'
const ID = /^\d{8}T\d{9}Z-[0-9a-f]{4}$/

/** Not versioned: the pictures. Every dot entry at the top (the import's records, the checks, the trash, the checkpoints) is left out too. */
const LEFT_OUT = new Set(['images', 'media'])

/** A world larger than this (text and packs, not pictures) is not copied: a checkpoint is a safety net for authored text, not a backup of a library. */
export const CHECKPOINT_MAX_BYTES = 64 * 1024 * 1024

/** The longest file the agent may read back from a checkpoint in one call. */
export const CHECKPOINT_READ_CHARS = 20_000

interface Stored extends CheckpointInfo {
  manifest: Record<string, string>
}

export class CheckpointError extends Error {}
export class CheckpointNotFoundError extends CheckpointError {}

const checkpointsOf = (world: string): string => join(world, CHECKPOINTS_FOLDER)
const folderOf = (world: string, id: string): string => join(checkpointsOf(world), id)

function validId(id: string): string {
  if (!ID.test(id)) throw new CheckpointNotFoundError(`there is no checkpoint "${id}"`)
  return id
}

const stamp = (): string => new Date().toISOString().replace(/[-:.]/g, '')

const leftOut = (top: string): boolean => top.startsWith('.') || LEFT_OUT.has(top)

interface Scanned { manifest: Record<string, string>; bytes: number }

/** The world's files that a checkpoint keeps, by path with the hash of their content. Links are skipped. */
async function scan(world: string, dir = '', top = true): Promise<Scanned> {
  const manifest: Record<string, string> = {}
  let bytes = 0
  for (const entry of await readdir(join(world, dir), { withFileTypes: true })) {
    if (top && leftOut(entry.name)) continue
    const path = dir === '' ? entry.name : `${dir}/${entry.name}`
    if (entry.isDirectory()) {
      const inner = await scan(world, path, false)
      Object.assign(manifest, inner.manifest)
      bytes += inner.bytes
    } else if (entry.isFile()) {
      const data = await readFile(join(world, path))
      manifest[path] = createHash('sha256').update(data).digest('hex')
      bytes += data.length
    }
  }
  return { manifest, bytes }
}

const same = (a: Record<string, string>, b: Record<string, string>): boolean => {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every(key => a[key] === b[key])
}

async function readStored(world: string, id: string): Promise<Stored> {
  try {
    return JSON.parse(await readFile(join(folderOf(world, validId(id)), INFO), 'utf8')) as Stored
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new CheckpointNotFoundError(`there is no checkpoint "${id}"`)
    throw error
  }
}

const infoOf = ({ manifest: _manifest, ...info }: Stored): CheckpointInfo => info

/** The checkpoints of a world, newest first. A folder that was cut short (no record) is not one. */
export async function listCheckpoints(world: string): Promise<CheckpointInfo[]> {
  let names: string[]
  try { names = await readdir(checkpointsOf(world)) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const found: CheckpointInfo[] = []
  for (const name of names.filter(each => ID.test(each))) {
    try { found.push(infoOf(await readStored(world, name))) } catch (error) { if (!(error instanceof CheckpointNotFoundError)) throw error }
  }
  return found.sort((a, b) => (a.id < b.id ? 1 : -1))
}

export interface CheckpointRequest {
  label: string
  reason: CheckpointReason
  chat?: string
  turn?: number
  /** How many checkpoints the world keeps: the newest ones. */
  keep: number
}

/**
 * Copies the world's files into `<world>/.checkpoints/<id>/`. A world that is the same as its newest checkpoint is not copied again, except on request. Older checkpoints beyond `keep` are removed.
 * @returns the checkpoint, and whether it was made now.
 */
export async function makeCheckpoint(world: string, request: CheckpointRequest): Promise<{ checkpoint: CheckpointInfo; made: boolean }> {
  const { manifest, bytes } = await scan(world)
  if (bytes > CHECKPOINT_MAX_BYTES) throw new CheckpointError(`the world's files are ${Math.round(bytes / 1024 / 1024)} MB, more than the ${CHECKPOINT_MAX_BYTES / 1024 / 1024} MB a checkpoint keeps`)
  const latest = (await listCheckpoints(world))[0]
  if (latest !== undefined && request.reason !== 'manual' && same((await readStored(world, latest.id)).manifest, manifest)) return { checkpoint: latest, made: false }
  const id = `${stamp()}-${randomBytes(2).toString('hex')}`
  const target = folderOf(world, id)
  try {
    for (const path of Object.keys(manifest)) {
      const to = join(target, FILES, path)
      await mkdir(dirname(to), { recursive: true })
      await copyFile(join(world, path), to)
    }
    const info: Stored = { id, at: new Date().toISOString(), label: request.label.slice(0, 200), reason: request.reason, ...(request.chat === undefined ? {} : { chat: request.chat }), ...(request.turn === undefined ? {} : { turn: request.turn }), files: Object.keys(manifest).length, bytes, manifest }
    await mkdir(target, { recursive: true })
    await atomicWriteJson(join(target, INFO), info)
    await prune(world, request.keep)
    return { checkpoint: infoOf(info), made: true }
  } catch (error) {
    await rm(target, { recursive: true, force: true })
    throw error
  }
}

async function prune(world: string, keep: number): Promise<void> {
  const all = await listCheckpoints(world)
  for (const old of all.slice(Math.max(1, keep))) await rm(folderOf(world, old.id), { recursive: true, force: true })
}

/** What differs between the world as it is and a checkpoint. */
export async function diffCheckpoint(world: string, id: string): Promise<CheckpointDiff> {
  const stored = await readStored(world, id)
  const { manifest } = await scan(world)
  return {
    changed: Object.keys(manifest).filter(path => stored.manifest[path] !== undefined && stored.manifest[path] !== manifest[path]).sort((a, b) => a.localeCompare(b)),
    added: Object.keys(manifest).filter(path => stored.manifest[path] === undefined).sort((a, b) => a.localeCompare(b)),
    removed: Object.keys(stored.manifest).filter(path => manifest[path] === undefined).sort((a, b) => a.localeCompare(b)),
  }
}

/** One file as the checkpoint has it. The path is one the checkpoint holds, never a way out of it. */
export async function readCheckpointFile(world: string, id: string, path: string): Promise<{ path: string; text: string; of: number; truncated: boolean }> {
  const stored = await readStored(world, id)
  const clean = normalize(path).split(sep).join('/')
  if (clean.startsWith('..') || clean.startsWith('/') || stored.manifest[clean] === undefined) throw new CheckpointNotFoundError(`checkpoint ${id} has no file "${path}"`)
  const text = await readFile(join(folderOf(world, id), FILES, clean), 'utf8')
  return { path: clean, text: text.slice(0, CHECKPOINT_READ_CHARS), of: text.length, truncated: text.length > CHECKPOINT_READ_CHARS }
}

/** Puts the world's files back as a checkpoint has them. What is there now is first kept as a checkpoint of its own and moved to the trash, so a restore can be undone. */
export async function restoreCheckpoint(world: string, id: string, keep: number): Promise<{ restored: CheckpointInfo; before?: CheckpointInfo }> {
  const stored = await readStored(world, id)
  for (const path of Object.keys(stored.manifest)) await stat(join(folderOf(world, id), FILES, path)).catch(() => { throw new CheckpointError(`checkpoint ${id} is incomplete: ${path} is missing`) })
  const before = (await makeCheckpoint(world, { label: `Before restoring “${stored.label}”`, reason: 'before-restore', keep: keep + 1 })).checkpoint
  const trash = join(world, '.trash', `restore-${stamp()}`)
  const moved: string[] = []
  const placed: string[] = []
  try {
    await mkdir(trash, { recursive: true })
    for (const entry of await readdir(world)) {
      if (leftOut(entry)) continue
      await rename(join(world, entry), join(trash, entry))
      moved.push(entry)
    }
    for (const path of Object.keys(stored.manifest)) {
      const to = join(world, path)
      await mkdir(dirname(to), { recursive: true })
      await copyFile(join(folderOf(world, id), FILES, path), to)
      placed.push(path.split('/')[0]!)
    }
    await atomicWriteJson(join(checkpointsOf(world), RESTORED), { at: new Date().toISOString(), checkpoint: id, label: stored.label })
    await prune(world, keep)
  } catch (error) {
    for (const top of new Set(placed)) await rm(join(world, top), { recursive: true, force: true })
    for (const entry of moved) await rename(join(trash, entry), join(world, entry)).catch(() => undefined)
    throw error
  }
  return { restored: infoOf(stored), before }
}

/** When and to what the world was last restored by the person, so that an authoring chat can be told. */
export async function lastRestore(world: string): Promise<{ at: string; checkpoint: string; label: string } | undefined> {
  try { return JSON.parse(await readFile(join(checkpointsOf(world), RESTORED), 'utf8')) as { at: string; checkpoint: string; label: string } } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}
