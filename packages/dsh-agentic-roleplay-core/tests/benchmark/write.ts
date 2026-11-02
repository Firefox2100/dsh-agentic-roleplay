import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { CheckedWorld } from '../../src/host/worlds/validated-world.ts'
import type { Files } from './language.ts'

/** Writes the files of a world under `directory`; a string is written as it is and anything else as JSON. */
export async function writeFiles(directory: string, files: Files): Promise<void> {
  for (const [path, value] of files) {
    const file = join(directory, path)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`)
  }
}

/** A world written to a folder of its own, as the checks are given it, and the way to remove it. */
export interface TempWorld {
  world: CheckedWorld
  directory: string
  remove(): Promise<void>
}

export async function tempWorld(files: Files, summary: { id: string; name: string }): Promise<TempWorld> {
  const directory = await mkdtemp(join(tmpdir(), 'benchmark-'))
  await writeFiles(directory, files)
  return { directory, world: { directory, summary: { ...summary, description: '', tags: [] } } as unknown as CheckedWorld, remove: () => rm(directory, { recursive: true, force: true }) }
}
