import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Whether the world is an import that was written but would not start yet: its import state (kept in the world's `.import` folder) says it is being repaired. */
export async function isDraftWorld(directory: string): Promise<boolean> {
  try {
    return (JSON.parse(await readFile(join(directory, '.import', 'state.json'), 'utf8')) as { phase?: unknown }).phase === 'repair'
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}
