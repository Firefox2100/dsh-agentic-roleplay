import { readdir } from 'node:fs/promises'

/**
 * Names of the subfolders of `dir`, sorted. Symbolic links are not followed
 * and a missing directory has none; any other failure is thrown.
 */
export async function subfolders(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort((a, b) => a.localeCompare(b))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}
