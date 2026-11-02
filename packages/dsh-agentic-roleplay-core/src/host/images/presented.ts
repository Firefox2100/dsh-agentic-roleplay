import { atomicWrite } from '../atomic-write.ts'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const PRESENTED_FOLDER = 'presented'

/** An existing image shown for a turn instead of a new one. */
export interface Presented {
  /** Under `images/`. */
  path: string
  /** Why it fits, in the words of the agent that chose it. */
  reason: string
  at: string
}

const fileOf = (folder: string, node: string): string => join(folder, 'images', PRESENTED_FOLDER, `${node}.json`)

/** The images shown for a timeline node that were not made for it. */
export async function presentedFor(sessionFolder: string, node: string): Promise<Presented[]> {
  try { return (JSON.parse(await readFile(fileOf(sessionFolder, node), 'utf8')) as { images: Presented[] }).images } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

/** Shows an existing image for a node, once. A node's file is its own: a branch or a rewind never changes another's. */
export async function present(sessionFolder: string, node: string, image: Omit<Presented, 'at'>): Promise<void> {
  const current = await presentedFor(sessionFolder, node)
  if (current.some(entry => entry.path === image.path)) return
  const file = fileOf(sessionFolder, node)
  await atomicWrite(file, JSON.stringify({ images: [...current, { ...image, at: new Date().toISOString() }] }, null, 2), { createDirectory: true })
}
