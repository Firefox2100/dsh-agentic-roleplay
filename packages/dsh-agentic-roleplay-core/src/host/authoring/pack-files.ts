import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { PACKS_FOLDER, PACK_API, type PackProblem } from '../../shared/interface-pack.ts'
import { InvalidEditProblems } from '../../shared/world-state.ts'
import { isPackId, packPath, readPack } from '../interface/pack.ts'
import { MAX_PACK_TEXT, packFileProblem } from './pack-jail.ts'

/** Where a text file of a pack is, once the pack name and the path are known to be allowed; otherwise why not. */
function placeOf(directory: string, pack: string, path: string, tool: 'read' | 'write', text = ''): string {
  if (!isPackId(pack)) throw new InvalidEditProblems([`"${pack}" is not a usable pack name (letters, digits, "-" and "_")`])
  const relative = packPath(path)
  if (relative === undefined) throw new InvalidEditProblems([`"${path}" is not a path inside a pack`])
  const file = join(directory, PACKS_FOLDER, pack, ...relative.split('/'))
  const problem = packFileProblem(tool, file, directory, [text])
  if (problem !== undefined) throw new InvalidEditProblems([problem])
  return file
}

const problemsOf = (directory: string, pack: string): PackProblem[] => {
  const folder = join(directory, PACKS_FOLDER, pack)
  return existsSync(join(folder, 'pack.json')) ? readPack(folder, pack, file => file).problems : [{ file: 'pack.json', message: 'the pack has no pack.json' }]
}

/** The text of one file of a pack, as the editor shows it. @throws {InvalidEditProblems} when the file is not a text file of a pack or is not there. */
export async function readWorldPackFile(directory: string, pack: string, path: string): Promise<string> {
  const file = placeOf(directory, pack, path, 'read')
  try { return await readFile(file, 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new InvalidEditProblems([`the pack "${pack}" has no file "${path}"`])
    throw error
  }
}

/**
 * Writes one text file of a pack, making the pack's folder when it is not there yet. The file is written whole (to a temporary file that is renamed), and the pack is read
 * again as a story start reads it.
 * @returns what is wrong with the pack now; the file is kept even then, so that it can be put right.
 * @throws {InvalidEditProblems} when the name, the path, the kind of file or the size is not allowed.
 */
export async function writeWorldPackFile(directory: string, pack: string, path: string, text: string): Promise<PackProblem[]> {
  if (Buffer.byteLength(text) > MAX_PACK_TEXT) throw new InvalidEditProblems([`a file holds at most ${MAX_PACK_TEXT / 1024} KB of text`])
  const file = placeOf(directory, pack, path, 'write', text)
  await mkdir(dirname(file), { recursive: true })
  const temporary = join(dirname(file), `.${process.pid}.${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, text)
    await rename(temporary, file)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
  return problemsOf(directory, pack)
}

/** Makes a pack with a manifest that names it and nothing else yet. @throws {InvalidEditProblems} when the name is not usable or the pack exists. */
export async function createWorldPack(directory: string, pack: string, name: string): Promise<PackProblem[]> {
  if (!isPackId(pack)) throw new InvalidEditProblems([`"${pack}" is not a usable pack name (letters, digits, "-" and "_")`])
  if (existsSync(join(directory, PACKS_FOLDER, pack))) throw new InvalidEditProblems([`the world already carries a pack "${pack}"`])
  return await writeWorldPackFile(directory, pack, 'pack.json', `${JSON.stringify({ name: name.trim() === '' ? pack : name.trim(), version: '1', api: PACK_API }, null, 2)}\n`)
}
