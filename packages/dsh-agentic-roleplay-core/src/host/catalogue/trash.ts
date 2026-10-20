import { readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

const DAY_MS = 86_400_000
const STAMP = /-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/
/** Staging folders left by an interrupted install are removed after this long. */
const STALE_STAGING_MS = DAY_MS

/** When a world's old files were moved to the trash, read from the folder name the update gave them; entries without such a stamp are not ours. */
function movedAt(name: string): number | undefined {
  const match = STAMP.exec(name)
  if (match === null) return undefined
  const time = Date.parse(`${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`)
  return Number.isNaN(time) ? undefined : time
}

async function entries(directory: string): Promise<string[]> {
  try { return await readdir(directory) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

/**
 * Removes what updates and installs leave behind: world files moved to `.trash/worlds/` more than `keepDays` days ago (0 keeps them for
 * good), and staging folders of an install that never finished. A folder that cannot be removed is reported and the rest still goes.
 * @returns the folders removed and the failures.
 */
export async function pruneTrash(root: string, keepDays: number, now = Date.now()): Promise<{ removed: string[]; failures: string[] }> {
  const removed: string[] = []
  const failures: string[] = []
  const drop = async (path: string, label: string): Promise<void> => {
    try { await rm(path, { recursive: true, force: true }); removed.push(label) } catch (error) { failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`) }
  }
  if (keepDays > 0) {
    for (const name of await entries(join(root, '.trash', 'worlds'))) {
      const at = movedAt(name)
      if (at !== undefined && now - at > keepDays * DAY_MS) await drop(join(root, '.trash', 'worlds', name), `.trash/worlds/${name}`)
    }
  }
  for (const name of await entries(join(root, '.install'))) {
    if (now - (await stat(join(root, '.install', name))).mtimeMs > STALE_STAGING_MS) await drop(join(root, '.install', name), `.install/${name}`)
  }
  return { removed, failures }
}
