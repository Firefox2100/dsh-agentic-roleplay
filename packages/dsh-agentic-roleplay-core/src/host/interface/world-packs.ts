import { existsSync } from 'node:fs'
import { mkdir, rename } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { PACKS_FOLDER, PACK_MEDIA_TYPES, type PackProblem } from '../../shared/interface-pack.ts'
import { isPackId, packPath, readPack } from './pack.ts'
import { packIds } from './packs.ts'

/** The kinds of file an assistant may write, as text. */
export const TEXT_EXTENSIONS: readonly string[] = ['html', 'css', 'js', 'json', 'txt', 'svg']

export interface WorldPackEntry {
  id: string
  name: string
  problems: PackProblem[]
  files: string[]
}

const folderOf = (directory: string, pack: string): string => join(directory, PACKS_FOLDER, pack)

function checked(directory: string, pack: string): string {
  if (!isPackId(pack)) throw new Error(`"${pack}" is not a usable pack name (letters, digits, "-" and "_")`)
  return folderOf(directory, pack)
}

/** What every pack the world carries holds and what is wrong with it. */
export function listWorldPacks(directory: string): WorldPackEntry[] {
  return packIds(directory).map((id) => {
    const { pack, problems } = readPack(folderOf(directory, id), id, file => file)
    const files = pack === undefined ? [] : [...pack.files.keys()]
    return { id, name: pack?.manifest.name ?? id, problems, files }
  })
}

/** What is wrong with a pack (nothing when it can be used). */
export function checkWorldPack(directory: string, pack: string): PackProblem[] {
  const folder = checked(directory, pack)
  if (!existsSync(folder)) throw new Error(`the world carries no pack "${pack}"`)
  return readPack(folder, pack, file => file).problems
}

/** Moves a file of a pack into the world's `.trash`. @returns where it went, and what is wrong with the pack now. */
export async function deleteWorldPackFile(directory: string, pack: string, path: string): Promise<{ trashPath: string; problems: PackProblem[] }> {
  const relative = packPath(path)
  if (relative === undefined || !(extname(relative).slice(1).toLowerCase() in PACK_MEDIA_TYPES)) throw new Error(`"${path}" is not a file of a pack`)
  const folder = checked(directory, pack)
  const file = join(folder, ...relative.split('/'))
  if (!existsSync(file)) throw new Error(`the pack "${pack}" has no file "${path}"`)
  const aside = join(directory, '.trash', PACKS_FOLDER, pack, `${relative.replaceAll('/', '__')}.${Date.now()}`)
  await mkdir(dirname(aside), { recursive: true })
  await rename(file, aside)
  return { trashPath: aside, problems: existsSync(join(folder, 'pack.json')) ? readPack(folder, pack, address => address).problems : [{ file: 'pack.json', message: 'the pack has no pack.json' }] }
}
