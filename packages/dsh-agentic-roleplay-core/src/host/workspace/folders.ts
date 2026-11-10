import { mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { FOLDER_ACCESS, MAX_STORY_FOLDERS, WORKSPACE_FOLDER, type FolderAccess, type StoryFolder } from '../../shared/folders.ts'

export const FOLDERS_FILE = 'folders.json'

export class InvalidFoldersError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join('; '))
    this.name = 'InvalidFoldersError'
  }
}

/** Whether `path` is `parent` or lies below it. */
export const isInside = (parent: string, path: string): boolean => {
  const inside = relative(parent, path)
  return inside === '' || (!inside.startsWith('..') && !isAbsolute(inside))
}

/** The folder every story's file tools reach. */
export const workspaceOf = (root: string): string => join(root, WORKSPACE_FOLDER)

function parse(value: unknown): StoryFolder[] {
  if (!Array.isArray(value)) throw new Error('folders must be a list')
  return value.map((entry): StoryFolder => {
    const folder = entry as Record<string, unknown>
    if (typeof folder !== 'object' || folder === null || typeof folder['path'] !== 'string' || !(FOLDER_ACCESS as readonly unknown[]).includes(folder['access'])) throw new Error('a folder needs a path and an access of read or write')
    return { path: folder['path'], access: folder['access'] as FolderAccess }
  })
}

/** The folders a story was given; none for a story that was never given any. */
export async function readFolders(sessionFolder: string): Promise<StoryFolder[]> {
  let text: string
  try {
    text = await readFile(join(sessionFolder, FOLDERS_FILE), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  return parse((JSON.parse(text) as { folders?: unknown }).folders ?? [])
}

/** The places no story may be given: the roleplay root and the folder above it (they hold every story), and DSH's own home. */
export const forbiddenFolders = (root: string): string[] => [root, join(homedir(), '.dsh')]

/**
 * The folders as they will be kept: absolute, real (a symbolic link is followed once, here), existing folders, without repeats,
 * none that would hand over the roleplay root or DSH's home, at most `MAX_STORY_FOLDERS`.
 * @throws {InvalidFoldersError} with every problem.
 */
export async function checkFolders(requested: readonly StoryFolder[], root: string): Promise<StoryFolder[]> {
  const problems: string[] = []
  if (requested.length > MAX_STORY_FOLDERS) problems.push(`a story may be given at most ${MAX_STORY_FOLDERS} folders`)
  const workspace = await realpath(workspaceOf(root)).catch(() => workspaceOf(root))
  const forbidden = await Promise.all(forbiddenFolders(root).map(async path => await realpath(path).catch(() => path)))
  const kept = new Map<string, StoryFolder>()
  for (const folder of requested) {
    if (!isAbsolute(folder.path)) { problems.push(`${folder.path}: give the whole path`); continue }
    let real: string
    try {
      real = await realpath(resolve(folder.path))
      if (!(await stat(real)).isDirectory()) { problems.push(`${folder.path} is not a folder`); continue }
    } catch {
      problems.push(`${folder.path} does not exist`)
      continue
    }
    if (real === dirname(real)) { problems.push('the whole disk cannot be given'); continue }
    const exposing = forbidden.find(path => isInside(real, path) || (isInside(path, real) && !isInside(workspace, real)))
    if (exposing !== undefined) { problems.push(`${folder.path}: it holds or lies in ${exposing}, which keeps every story`); continue }
    const earlier = kept.get(real)
    kept.set(real, { path: real, access: earlier?.access === 'write' || folder.access === 'write' ? 'write' : 'read' })
  }
  if (problems.length > 0) throw new InvalidFoldersError(problems)
  return [...kept.values()]
}

/** Writes the story's folders after checking them, and returns what was kept. */
export async function writeFolders(sessionFolder: string, requested: readonly StoryFolder[], root: string): Promise<StoryFolder[]> {
  const folders = await checkFolders(requested, root)
  const target = join(sessionFolder, FOLDERS_FILE)
  await mkdir(sessionFolder, { recursive: true })
  await writeFile(`${target}.writing`, JSON.stringify({ folders }, null, 2))
  await rename(`${target}.writing`, target)
  return folders
}
