import { cpSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PACKS_FOLDER } from '../../shared/interface-pack.ts'
import { isPackId } from './pack.ts'

/** The folder of the packs shipped with the package. */
export const FIRST_PARTY_FOLDER = 'packs'

/** Found from this module, so that it works from source and from the build. */
export function firstPartyDirectory(from: string = dirname(fileURLToPath(import.meta.url))): string {
  for (let directory = from; ; directory = dirname(directory)) {
    const candidate = join(directory, FIRST_PARTY_FOLDER)
    if (existsSync(join(directory, 'package.json')) && existsSync(candidate)) return candidate
    if (dirname(directory) === directory) throw new Error('the interface packs shipped with the package were not found')
  }
}

/**
 * Puts the packs that ship with the package into the roleplay root's own `ui` folder, where any story can use one by naming it. A pack
 * that is there is never overwritten, so it can be edited; one that was deleted comes back.
 * @returns the packs that were put there.
 */
export function installFirstPartyPacks(root: string, shipped: string = firstPartyDirectory()): string[] {
  const installed: string[] = []
  for (const entry of readdirSync(shipped, { withFileTypes: true })) {
    if (!entry.isDirectory() || !isPackId(entry.name)) continue
    const target = join(root, PACKS_FOLDER, entry.name)
    if (existsSync(target)) continue
    cpSync(join(shipped, entry.name), target, { recursive: true })
    installed.push(entry.name)
  }
  return installed
}
